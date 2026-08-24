#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

const [outputPath, sourceDate, ...inputPaths] = process.argv.slice(2);
if (!outputPath || !/^\d{4}-\d{2}-\d{2}$/.test(sourceDate ?? "") || inputPaths.length === 0) {
  throw new Error("usage: generate-osm-building-extract.mjs OUTPUT.geojson YYYY-MM-DD INPUT.osm [INPUT.osm ...]");
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function attributes(fragment) {
  const result = {};
  for (const match of fragment.matchAll(/([:\w-]+)="([^"]*)"/g)) {
    result[match[1]] = decodeXml(match[2]);
  }
  return result;
}

const nodes = new Map();
const ways = new Map();
const bounds = [];

for (const inputPath of inputPaths) {
  const xml = readFileSync(inputPath, "utf8");
  for (const match of xml.matchAll(/<bounds\s+([^>]+)\/>/g)) {
    const value = attributes(match[1]);
    bounds.push([Number(value.minlon), Number(value.minlat), Number(value.maxlon), Number(value.maxlat)]);
  }
  for (const match of xml.matchAll(/<node\s+([^>]+?)(?:\/>|>[\s\S]*?<\/node>)/g)) {
    const value = attributes(match[1]);
    nodes.set(value.id, [Number(value.lon), Number(value.lat)]);
  }
  for (const match of xml.matchAll(/<way\s+([^>]+)>([\s\S]*?)<\/way>/g)) {
    const way = attributes(match[1]);
    if (ways.has(way.id)) continue;
    const body = match[2];
    const tags = Object.fromEntries([...body.matchAll(/<tag\s+([^>]+)\/>/g)].map((tag) => {
      const value = attributes(tag[1]);
      return [value.k, value.v];
    }));
    if (!tags.building) continue;
    const nodeIds = [...body.matchAll(/<nd\s+([^>]+)\/>/g)].map((node) => attributes(node[1]).ref);
    if (nodeIds.length < 4 || nodeIds[0] !== nodeIds.at(-1)) continue;
    const coordinates = nodeIds.map((nodeId) => nodes.get(nodeId));
    if (coordinates.some((coordinate) => !coordinate)) continue;
    ways.set(way.id, {
      type: "Feature",
      properties: {
        osm_id: Number(way.id),
        building: tags.building,
        ...(tags.name ? { name: tags.name } : {}),
        ...(tags["building:levels"] ? { levels: tags["building:levels"] } : {}),
      },
      geometry: { type: "Polygon", coordinates: [coordinates] },
    });
  }
}

const features = [...ways.values()].sort((left, right) => left.properties.osm_id - right.properties.osm_id);
writeFileSync(outputPath, `${JSON.stringify({
  type: "FeatureCollection",
  metadata: {
    bounds,
    source: "OpenStreetMap API extracts",
    sourceDate,
    license: "ODbL-1.0",
  },
  features,
})}\n`);

process.stdout.write(`buildings=${features.length}\n`);
