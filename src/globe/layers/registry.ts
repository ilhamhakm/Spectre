import type { LayerId } from "@/store/globe-store";
import type { LayerImpl } from "./types";
import { commercialFlightsLayer, privateFlightsLayer, militaryFlightsLayer } from "./flights";
import { satellitesLayer } from "./satellites";
import { earthquakesLayer, civilUnrestLayer } from "./geo-layers";
import { radioLayer } from "@/globe/radio/radio-engine";
import trafficLayer from "./traffic/traffic";
import { damsLayer, dataCentersLayer } from "./local-infrastructure";
import { cctvLayer } from "./cctv";
import { buildings3dLayer } from "./buildings";
import { bigChangesReplayLayer, constructionReplayLayer } from "./replay-gibs";
import { bordersLayer, googleTilesLayer } from "./actions";

// Registry: maps LayerId to its implementation
export const LAYER_REGISTRY: Record<LayerId, LayerImpl> = {
  "commercial-flights": commercialFlightsLayer,
  "private-flights": privateFlightsLayer,
  "military-flights": militaryFlightsLayer,
  satellites: satellitesLayer,
  dams: damsLayer,
  earthquakes: earthquakesLayer,
  "data-centers": dataCentersLayer,
  "civil-unrest": civilUnrestLayer,
  traffic: trafficLayer,
  cctv: cctvLayer,
  "3d-buildings": buildings3dLayer,
  radio: radioLayer,
  "big-changes-replay": bigChangesReplayLayer,
  "construction-replay": constructionReplayLayer,
};

// Action layers (not in the LayerId union, managed separately)
export const ACTION_LAYERS = {
  borders: bordersLayer,
  googleTiles: googleTilesLayer,
};
