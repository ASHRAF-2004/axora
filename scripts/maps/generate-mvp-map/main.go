package main

import (
  "bufio"
  "encoding/json"
  "errors"
  "fmt"
  "io"
  "math"
  "os"
  "runtime"
  "sort"

  "github.com/qedus/osmpbf"
)

const minLon, minLat, maxLon, maxLat = 101.35, 2.70, 102.00, 3.45

type coord struct { Lon float64; Lat float64 }
type feature struct { Type string `json:"type"`; Properties map[string]any `json:"properties"`; Geometry geometry `json:"geometry"` }
type geometry struct { Type string `json:"type"`; Coordinates any `json:"coordinates"` }
type collection struct { Type string `json:"type"`; Metadata map[string]any `json:"metadata"`; Features []feature `json:"features"` }
type road struct { ID int64; Class, Name string; Lines [][][]float64 }
type place struct { ID int64; Class, Name string; Point []float64 }

func round6(value float64) float64 { return math.Round(value*1e5)/1e5 }
func inBounds(lon, lat float64) bool { return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat }
func supportedLabel(value string) bool {
  for _, r := range value { if r > 511 { return false } }
  return true
}
func roadAllowed(class, name string) bool {
  switch class {
  case "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link": return true
  default: return false
  }
}
func writeCollection(path string, features []feature) error {
  f, err := os.Create(path); if err != nil { return err }; defer f.Close()
  out := collection{Type:"FeatureCollection", Metadata:map[string]any{"coverage":[4]float64{minLon,minLat,maxLon,maxLat},"source":"Geofabrik Malaysia, Singapore and Brunei OpenStreetMap extract","sourceDate":"2026-08-14"}, Features:features}
  w := bufio.NewWriterSize(f, 1<<20); enc := json.NewEncoder(w); enc.SetEscapeHTML(false)
  if err := enc.Encode(out); err != nil { return err }; return w.Flush()
}
func main() {
  if len(os.Args) != 4 { panic("usage: generate-mvp-map INPUT.osm.pbf ROADS.geojson PLACES.geojson") }
  source, err := os.Open(os.Args[1]); if err != nil { panic(err) }; defer source.Close()
  decoder := osmpbf.NewDecoder(source); decoder.SetBufferSize(osmpbf.MaxBlobSize)
  if err := decoder.Start(runtime.GOMAXPROCS(0)); err != nil { panic(err) }
  nodes := make(map[int64]coord, 1_000_000); roads := make([]road, 0, 100_000); places := make([]place, 0, 2_000)
  for {
    value, err := decoder.Decode(); if errors.Is(err, io.EOF) { break }; if err != nil { panic(err) }
    switch item := value.(type) {
    case *osmpbf.Node:
      if !inBounds(item.Lon, item.Lat) { continue }
      nodes[item.ID] = coord{Lon:round6(item.Lon), Lat:round6(item.Lat)}
      if class, name := item.Tags["place"], item.Tags["name"]; class != "" && name != "" && supportedLabel(name) {
        switch class { case "city", "town", "suburb", "village", "neighbourhood": places = append(places, place{item.ID,class,name,[]float64{round6(item.Lon),round6(item.Lat)}}) }
      }
    case *osmpbf.Way:
      class, name := item.Tags["highway"], item.Tags["name"]; if !roadAllowed(class,name) { continue }; if !supportedLabel(name) { name = "" }
      lines := make([][][]float64,0,2); line := make([][]float64,0,len(item.NodeIDs))
      flush := func(){ if len(line)>=2 { lines=append(lines,line) }; line=make([][]float64,0,len(item.NodeIDs)) }
      for _, id := range item.NodeIDs { if point, ok := nodes[id]; ok { line=append(line,[]float64{point.Lon,point.Lat}) } else { flush() } }; flush()
      if len(lines)>0 { roads=append(roads,road{item.ID,class,name,lines}) }
    }
  }
  sort.Slice(roads,func(i,j int)bool{return roads[i].ID<roads[j].ID}); sort.Slice(places,func(i,j int)bool{return places[i].ID<places[j].ID})
  grouped:=make(map[string]road,len(roads)); keys:=make([]string,0,len(roads)); for _,r:=range roads { key:=r.Class+"\x00"+r.Name; current,ok:=grouped[key]; if !ok { current=road{Class:r.Class,Name:r.Name}; keys=append(keys,key) }; current.Lines=append(current.Lines,r.Lines...); grouped[key]=current }; sort.Strings(keys)
  roadFeatures:=make([]feature,0,len(keys)); for _,key:=range keys { r:=grouped[key]; roadFeatures=append(roadFeatures,feature{"Feature",map[string]any{"class":r.Class,"name":r.Name},geometry{"MultiLineString",r.Lines}}) }
  placeFeatures:=make([]feature,0,len(places)); for _,p:=range places { placeFeatures=append(placeFeatures,feature{"Feature",map[string]any{"osm_id":p.ID,"class":p.Class,"name":p.Name},geometry{"Point",p.Point}}) }
  if err:=writeCollection(os.Args[2],roadFeatures); err!=nil { panic(err) }; if err:=writeCollection(os.Args[3],placeFeatures); err!=nil { panic(err) }
  fmt.Printf("nodes=%d roads=%d places=%d\n",len(nodes),len(roads),len(places))
}
