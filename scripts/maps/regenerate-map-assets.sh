#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="${1:?usage: regenerate-map-assets.sh SOURCE_ARCHIVE_DIRECTORY}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/axora-map-assets.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

COUNTRIES="$SOURCE_DIR/ne_10m_admin_0_countries-5.1.1.zip"
PLACES="$SOURCE_DIR/ne_10m_populated_places-5.1.2.zip"
OSM="$SOURCE_DIR/malaysia-singapore-brunei-20260814.osm.pbf"
sha256sum -c <<CHECKSUMS
ce1ac7036499a0edd641fbc093cd209a98f96a49d2eca8480aaacad35138a7f6  $COUNTRIES
cd149186f03d2603e0410da399b980a4357d0ac32d3a2305a49ed3dffcc41d7b  $PLACES
8c79573860d46190283231bc063cdbb95fecd660d6dd2e8b4d3a232fe1fa0455  $OSM
CHECKSUMS

unzip -q "$COUNTRIES" -d "$WORK_DIR/countries"
unzip -q "$PLACES" -d "$WORK_DIR/places"
npx --yes mapshaper@0.6.113 "$WORK_DIR/countries/ne_10m_admin_0_countries.shp" \
  -filter '["Indonesia","Malaysia","India","China","Bhutan","Vietnam","Cambodia","Laos","Thailand","East Timor","Brunei","Myanmar","Bangladesh","Nepal","Papua New Guinea","Australia","Philippines","Taiwan"].includes(ADMIN)' \
  -filter-fields ADMIN,ISO_A2,NAME,NAME_EN,NAME_AR,NAME_ID \
  -simplify 5% keep-shapes \
  -o "${REPOSITORY_ROOT}/public/maps/natural-earth-southeast-asia-countries.geojson" format=geojson precision=0.000001
npx --yes mapshaper@0.6.113 "$WORK_DIR/places/ne_10m_populated_places.shp" \
  -filter '["Baguio","Dili","Vientiane","Bandar Seri Begawan","Phnom Penh","Naypyidaw","Hanoi","Kuala Lumpur","Dhaka","Yangon","Bangkok","Manila","Taipei","Jakarta","Kolkata","Singapore","Hong Kong"].includes(NAME)' \
  -filter-fields NAME,NAMEASCII,ADM0NAME,MIN_ZOOM,LATITUDE,LONGITUDE \
  -rename-fields name=NAME,nameascii=NAMEASCII,adm0name=ADM0NAME,min_zoom=MIN_ZOOM,latitude=LATITUDE,longitude=LONGITUDE \
  -o "${REPOSITORY_ROOT}/public/maps/natural-earth-southeast-asia-places.geojson" format=geojson precision=0.000001

(cd "$REPOSITORY_ROOT/scripts/maps/generate-mvp-map" && go run . "$OSM" \
  "$REPOSITORY_ROOT/public/maps/mvp-klang-valley-roads.geojson" \
  "$REPOSITORY_ROOT/public/maps/mvp-klang-valley-places.geojson")

sha256sum -c <<CHECKSUMS
771a214372e19b95eed6f01136100b02e99b82972c629860a13816a653602cfd  $REPOSITORY_ROOT/public/maps/natural-earth-southeast-asia-countries.geojson
0895ae4923b6cd33b97e544370ff3f26ca5b7c39308ce5764f3e495168164225  $REPOSITORY_ROOT/public/maps/natural-earth-southeast-asia-places.geojson
5ebef2a05863c3b20dface72a0b8b000c98ef016cb3b9de7425590db65044bc3  $REPOSITORY_ROOT/public/maps/mvp-klang-valley-roads.geojson
d9c7a94114e08ea4470b5ce3ee47bb9e4c3bff38bf37c528b11360f8faa5b818  $REPOSITORY_ROOT/public/maps/mvp-klang-valley-places.geojson
CHECKSUMS
