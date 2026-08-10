"use client";

import { useEffect, useState } from "react";
import * as Cesium from "cesium";
import { useGlobeStore, type SavedView } from "@/store/globe-store";
import PrivateFlightsPanel from "@/components/PrivateFlightsPanel";
import CctvSourceList from "@/components/CctvSourceList";

type Props = {
  visible?: boolean;
};

interface CityBookmark {
  name: string;
  // Landmark subtitle shown under the city name in the menu — gives the
  // user a hint of what they'll see when they fly there.
  landmark: string;
  // Country the city belongs to — stored for future use, not rendered.
  country: string;
  lat: number;
  lon: number;
  height: number;
  heading?: number;
  pitch?: number;
  // True when Google Photorealistic 3D Tiles do NOT cover this city — the
  // bookmark label is suffixed "(OSM)" to signal that the OSM Buildings
  // fallback (gray extruded boxes) will be the only 3D shown.
  osm?: boolean;
}

interface Country {
  name: string;
  // Country view — mid-altitude camera framing the whole country. Triggered
  // by clicking the country's name in the menu (after drilling into a
  // continent).
  lat: number;
  lon: number;
  height: number;
  heading?: number;
  pitch?: number;
  cities: CityBookmark[];
}

interface Continent {
  name: string;
  // Continental view — high-altitude top-down camera framing the whole
  // continent. Triggered by clicking the continent's name in the menu.
  lat: number;
  lon: number;
  height: number;
  heading?: number;
  pitch?: number;
  countries: Country[];
}

// Three-level geographic hierarchy: continent -> country -> city.
// Each level mirrors a canonical OpenStreetMap (OSM) tagging scheme, so the
// static data below could later be replaced by live Overpass API queries
// without changing the panel structure.
//
// OSM tag mapping per level:
//   - Continent -> place=continent
//                  (Overpass: node["place"="continent"]["name"="Europe"])
//                  OSM's standard tag for the seven continents; rarely
//                  traversed but well-defined.
//   - Country   -> boundary=administrative + admin_level=2
//                  admin_level=2 is the OSM convention for sovereign
//                  countries and equivalent top-level administrative
//                  divisions. (place=country also exists but is rarely
//                  populated; admin_level=2 is the canonical, well-maintained
//                  tag used by OSM's country boundaries.)
//                  (Overpass: relation["boundary"="administrative"]
//                             ["admin_level"="2"]["name"="France"];)
//   - City      -> place=city | place=town
//                  Larger cities use place=city; smaller ones place=town.
//                  Cities are also tagged as boundary=administrative with
//                  admin_level values that vary by country (e.g. Germany 6
//                  for city-municipalities, Italy 8 for comuni, the US 6/7
//                  for incorporated places). For the panel we use the
//                  simpler place=city / place=town tags as the primary
//                  filter — they are consistently populated worldwide.
//                  (Overpass: node["place"~"city|town"]["name"="Tokyo"];)
//
// Continents -> countries -> cities menu. By default the panel shows the
// continents list; clicking the ">" arrow on a continent row drills into its
// countries; clicking the ">" arrow on a country row drills into its cities.
// Clicking a city flies the camera there at an oblique angle to show 3D
// buildings (where Google 3D Tiles are available). If the user has saved a
// custom view for a city (via the Save View button), that view is used
// instead of the default.
//
// Cities marked `osm: true` are NOT covered by Google Photorealistic 3D
// Tiles (per Google's official country-level coverage table, verified
// 2026-08-04):
//   - Indonesia (ID): Bali, Jakarta — country has no 3D Tiles coverage
//   - Saudi Arabia (SA): Mecca, Medina — country has no 3D Tiles coverage
//   - United Arab Emirates (AE): Dubai — country has no 3D Tiles coverage
// These cities fall back to OSM Buildings (gray extruded boxes) and are
// suffixed "(OSM)" in the menu. All other cities below have 3D Tiles.
const CONTINENTS: Continent[] = [
  {
    name: "North America",
    lat: 45,
    lon: -100,
    height: 5_000_000,
    heading: 0,
    pitch: -90,
    countries: [
      {
        name: "USA",
        lat: 38,
        lon: -97,
        height: 3500000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "New York", landmark: "Statue of Liberty", country: "USA", lat: 40.758, lon: -73.9855, height: 1500, heading: 0, pitch: -35 },
        { name: "Washington", landmark: "Washington Monument", country: "USA", lat: 38.8895, lon: -77.0353, height: 1500, heading: 0, pitch: -35 },
        { name: "Los Angeles", landmark: "Griffith Observatory", country: "USA", lat: 34.1184, lon: -118.3004, height: 2000 },
        { name: "San Francisco", landmark: "Golden Gate Bridge", country: "USA", lat: 37.8199, lon: -122.4783, height: 1800 },
        { name: "Chicago", landmark: "Willis Tower", country: "USA", lat: 41.8789, lon: -87.6359, height: 1800 },
        { name: "Las Vegas", landmark: "Strip", country: "USA", lat: 36.1147, lon: -115.1728, height: 1800 },
        { name: "Miami", landmark: "South Beach", country: "USA", lat: 25.7907, lon: -80.1300, height: 1800 },
        { name: "Seattle", landmark: "Space Needle", country: "USA", lat: 47.6205, lon: -122.3493, height: 1500 },
        { name: "Boston", landmark: "Fenway Park", country: "USA", lat: 42.3467, lon: -71.0972, height: 1500 },
        { name: "Houston", landmark: "Space Center", country: "USA", lat: 29.551, lon: -95.0977, height: 1800 },
        { name: "Philadelphia", landmark: "Independence Hall", country: "USA", lat: 39.949, lon: -75.15, height: 1500 },
        { name: "Atlanta", landmark: "Georgia Aquarium", country: "USA", lat: 33.7635, lon: -84.395, height: 1500 },
        { name: "Denver", landmark: "Red Rocks", country: "USA", lat: 39.6655, lon: -105.2058, height: 1800 },
        { name: "San Diego", landmark: "Balboa Park", country: "USA", lat: 32.734, lon: -117.1445, height: 1500 },
        { name: "Portland", landmark: "Pittock Mansion", country: "USA", lat: 45.5231, lon: -122.6765, height: 1500 },
        ],
      },
      {
        name: "Canada",
        lat: 56,
        lon: -106,
        height: 3500000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Toronto", landmark: "CN Tower", country: "Canada", lat: 43.6426, lon: -79.3871, height: 1500 },
        { name: "Vancouver", landmark: "Stanley Park", country: "Canada", lat: 49.3043, lon: -123.1443, height: 1800 },
        { name: "Montreal", landmark: "Notre-Dame Basilica", country: "Canada", lat: 45.5048, lon: -73.5732, height: 1500 },
        { name: "Calgary", landmark: "Calgary Tower", country: "Canada", lat: 51.0447, lon: -114.0719, height: 1500 },
        { name: "Ottawa", landmark: "Parliament Hill", country: "Canada", lat: 45.4215, lon: -75.6972, height: 1200 },
        { name: "Quebec City", landmark: "Chateau Frontenac", country: "Canada", lat: 46.812, lon: -71.205, height: 1200 },
        ],
      },
      {
        name: "Mexico",
        lat: 23.6,
        lon: -102,
        height: 1200000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Mexico City", landmark: "Zócalo", country: "Mexico", lat: 19.4326, lon: -99.1332, height: 2000 },
        { name: "Guadalajara", landmark: "Hospicio Cabanas", country: "Mexico", lat: 20.6767, lon: -103.3475, height: 1500, osm: true },
        { name: "Monterrey", landmark: "Macroplaza", country: "Mexico", lat: 25.6692, lon: -100.309, height: 1500, osm: true },
        { name: "Cancun", landmark: "Mayan Ruins", country: "Mexico", lat: 21.1619, lon: -86.8515, height: 1500, osm: true },
        ],
      },
      {
        name: "Cuba",
        lat: 21.5,
        lon: -78,
        height: 400000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Havana", landmark: "Capitolio", country: "Cuba", lat: 23.1359, lon: -82.3590, height: 1500 },
        { name: "Santiago de Cuba", landmark: "San Pedro de la Roca Castle", country: "Cuba", lat: 20.0247, lon: -75.8219, height: 1200, osm: true },
        ],
      },
    ],
  },
  {
    name: "South America",
    lat: -15,
    lon: -60,
    height: 6_000_000,
    heading: 0,
    pitch: -90,
    countries: [
      {
        name: "Brazil",
        lat: -10,
        lon: -55,
        height: 2500000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Rio de Janeiro", landmark: "Christ the Redeemer", country: "Brazil", lat: -22.9519, lon: -43.2105, height: 1800 },
        { name: "São Paulo", landmark: "Avenida Paulista", country: "Brazil", lat: -23.5613, lon: -46.6565, height: 2000 },
        { name: "Brasilia", landmark: "Congress Building", country: "Brazil", lat: -15.7939, lon: -47.8828, height: 1800, osm: true },
        { name: "Salvador", landmark: "Pelourinho", country: "Brazil", lat: -12.9714, lon: -38.5014, height: 1500, osm: true },
        { name: "Fortaleza", landmark: "Beach Park", country: "Brazil", lat: -3.7319, lon: -38.5267, height: 1500, osm: true },
        ],
      },
      {
        name: "Argentina",
        lat: -38,
        lon: -64,
        height: 2000000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Buenos Aires", landmark: "Casa Rosada", country: "Argentina", lat: -34.6076, lon: -58.3705, height: 1800 },
        { name: "Cordoba", landmark: "Jesuit Block", country: "Argentina", lat: -31.4201, lon: -64.1888, height: 1500, osm: true },
        { name: "Mendoza", landmark: "Independence Plaza", country: "Argentina", lat: -32.8895, lon: -68.8458, height: 1500, osm: true },
        { name: "Ushuaia", landmark: "End of the World Train", country: "Argentina", lat: -54.8019, lon: -68.303, height: 1500, osm: true },
        ],
      },
      {
        name: "Peru",
        lat: -10,
        lon: -76,
        height: 800000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Lima", landmark: "Plaza Mayor", country: "Peru", lat: -12.0464, lon: -77.0428, height: 1800 },
        { name: "Cusco", landmark: "Sacsayhuaman", country: "Peru", lat: -13.5164, lon: -71.9785, height: 1500, osm: true },
        { name: "Arequipa", landmark: "Santa Catalina Monastery", country: "Peru", lat: -16.2393, lon: -71.54, height: 1500, osm: true },
        ],
      },
      {
        name: "Colombia",
        lat: 4,
        lon: -73,
        height: 700000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Bogotá", landmark: "Monserrate", country: "Colombia", lat: 4.6050, lon: -74.0555, height: 2000 },
        { name: "Medellin", landmark: "Botero Plaza", country: "Colombia", lat: 6.2442, lon: -75.5812, height: 1500, osm: true },
        { name: "Cartagena", landmark: "Walled City", country: "Colombia", lat: 10.4236, lon: -75.5512, height: 1500, osm: true },
        ],
      },
      {
        name: "Chile",
        lat: -35,
        lon: -71,
        height: 1200000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Santiago", landmark: "Costanera Center", country: "Chile", lat: -33.4169, lon: -70.6067, height: 1800 },
        { name: "Valparaiso", landmark: "Colorful Houses", country: "Chile", lat: -33.0472, lon: -71.6127, height: 1200, osm: true },
        { name: "Pucon", landmark: "Villaricca Volcano", country: "Chile", lat: -39.274, lon: -71.9788, height: 1500, osm: true },
        ],
      },
      {
        name: "Ecuador",
        lat: -1.5,
        lon: -78,
        height: 400000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Quito", landmark: "TelefériQo", country: "Ecuador", lat: -0.1581, lon: -78.4947, height: 1800 },
        { name: "Guayaquil", landmark: "Malecon 2000", country: "Ecuador", lat: -2.1709, lon: -79.9224, height: 1500, osm: true },
        { name: "Galapagos", landmark: "Tortoise Breeding Center", country: "Ecuador", lat: -0.7436, lon: -90.3269, height: 2000, osm: true },
        ],
      },
      {
        name: "Bolivia",
        lat: -17,
        lon: -65,
        height: 700000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "La Paz", landmark: "Illimani viewpoint", country: "Bolivia", lat: -16.5000, lon: -68.1500, height: 2000 },
        { name: "Sucre", landmark: "Casa de la Libertad", country: "Bolivia", lat: -19.0196, lon: -65.2619, height: 1500, osm: true },
        { name: "Santa Cruz", landmark: "Plaza 24 de Septiembre", country: "Bolivia", lat: -17.7833, lon: -63.1821, height: 1500, osm: true },
        ],
      },
    ],
  },
  {
    name: "Oceania",
    lat: -25,
    lon: 140,
    height: 4_000_000,
    heading: 0,
    pitch: -90,
    countries: [
      {
        name: "New Zealand",
        lat: -41,
        lon: 174,
        height: 600000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Auckland", landmark: "Sky Tower", country: "New Zealand", lat: -36.8485, lon: 174.7633, height: 2000, heading: 0, pitch: -35 },
        { name: "Wellington", landmark: "Beehive", country: "New Zealand", lat: -41.2780, lon: 174.7770, height: 1500 },
        { name: "Christchurch", landmark: "Cardboard Cathedral", country: "New Zealand", lat: -43.53, lon: 172.62, height: 1200 },
        { name: "Queenstown", landmark: "Skyline Gondola", country: "New Zealand", lat: -45.0312, lon: 168.6626, height: 1500 },
        ],
      },
      {
        name: "Australia",
        lat: -25,
        lon: 134,
        height: 2500000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Sydney", landmark: "Sydney Opera House", country: "Australia", lat: -33.8568, lon: 151.2153, height: 1500 },
        { name: "Melbourne", landmark: "Federation Square", country: "Australia", lat: -37.8180, lon: 144.9670, height: 1500 },
        { name: "Brisbane", landmark: "Story Bridge", country: "Australia", lat: -27.4210, lon: 153.1490, height: 1500 },
        { name: "Perth", landmark: "Kings Park", country: "Australia", lat: -31.9680, lon: 115.8300, height: 1500 },
        { name: "Adelaide", landmark: "Adelaide Oval", country: "Australia", lat: -34.9285, lon: 138.6007, height: 1500 },
        { name: "Gold Coast", landmark: "Q1 Tower", country: "Australia", lat: -28.0016, lon: 153.4309, height: 1500 },
        { name: "Canberra", landmark: "Parliament House", country: "Australia", lat: -35.3082, lon: 149.1244, height: 1500 },
        { name: "Darwin", landmark: "Mindil Beach", country: "Australia", lat: -12.4634, lon: 130.8456, height: 1500, osm: true },
        { name: "Hobart", landmark: "Mount Wellington", country: "Australia", lat: -42.8821, lon: 147.3272, height: 1200 },
        ],
      },
    ],
  },
  {
    name: "Europe",
    lat: 50,
    lon: 10,
    height: 3_500_000,
    heading: 0,
    pitch: -90,
    countries: [
      {
        name: "Spain",
        lat: 40,
        lon: -3.7,
        height: 1_000_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "Barcelona", landmark: "Sagrada Família", country: "Spain", lat: 41.387, lon: 2.1685, height: 1500, heading: 90, pitch: -35 },
          { name: "Madrid", landmark: "Royal Palace", country: "Spain", lat: 40.4178, lon: -3.7143, height: 1500 },
        { name: "Valencia", landmark: "City of Arts and Sciences", country: "Spain", lat: 39.4699, lon: -0.3763, height: 1500 },
        { name: "Seville", landmark: "Plaza de Espana", country: "Spain", lat: 37.3772, lon: -5.9869, height: 1500 },
        { name: "Bilbao", landmark: "Guggenheim Museum", country: "Spain", lat: 43.263, lon: -2.935, height: 1200 },
        ],
      },
      {
        name: "France",
        lat: 46.2,
        lon: 2.2,
        height: 1_000_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "Paris", landmark: "Eiffel Tower", country: "France", lat: 48.8606, lon: 2.3376, height: 1500, heading: 0, pitch: -35 },
        { name: "Marseille", landmark: "Notre-Dame de la Garde", country: "France", lat: 43.2965, lon: 5.3698, height: 1500 },
        { name: "Nice", landmark: "Promenade des Anglais", country: "France", lat: 43.7102, lon: 7.262, height: 1200 },
        { name: "Lyon", landmark: "Fourviere Basilica", country: "France", lat: 45.764, lon: 4.8357, height: 1200 },
        { name: "Bordeaux", landmark: "Place de la Bourse", country: "France", lat: 44.8378, lon: -0.5792, height: 1200 },
        ],
      },
      {
        name: "Italy",
        lat: 41.9,
        lon: 12.5,
        height: 900_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "Rome", landmark: "Colosseum", country: "Italy", lat: 41.8902, lon: 12.4922, height: 1500, heading: 0, pitch: -35 },
          { name: "Milan", landmark: "Duomo di Milano", country: "Italy", lat: 45.4642, lon: 9.19, height: 1200, heading: 0, pitch: -35 },
          { name: "Florence", landmark: "Santa Maria del Fiore", country: "Italy", lat: 43.7696, lon: 11.2558, height: 1200, heading: 0, pitch: -35 },
          { name: "Venice", landmark: "St. Mark's Square", country: "Italy", lat: 45.4408, lon: 12.3155, height: 1000, heading: 0, pitch: -35 },
        { name: "Naples", landmark: "Mount Vesuvius", country: "Italy", lat: 40.8518, lon: 14.2681, height: 1500 },
        { name: "Turin", landmark: "Mole Antonelliana", country: "Italy", lat: 45.0703, lon: 7.6869, height: 1200 },
        { name: "Bologna", landmark: "Two Towers", country: "Italy", lat: 44.4949, lon: 11.3426, height: 1200 },
        ],
      },
      {
        name: "UK",
        lat: 54,
        lon: -2,
        height: 900_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "London", landmark: "Big Ben", country: "UK", lat: 51.5007, lon: -0.1246, height: 1800 },
        { name: "Manchester", landmark: "Old Trafford", country: "UK", lat: 53.4631, lon: -2.2913, height: 1500 },
        { name: "Edinburgh", landmark: "Edinburgh Castle", country: "UK", lat: 55.9489, lon: -3.1994, height: 1200 },
        { name: "Liverpool", landmark: "Royal Albert Dock", country: "UK", lat: 53.4, lon: -3, height: 1200 },
        { name: "Birmingham", landmark: "Library of Birmingham", country: "UK", lat: 52.4862, lon: -1.8904, height: 1200 },
        { name: "Glasgow", landmark: "Kelvingrove Museum", country: "UK", lat: 55.8642, lon: -4.2518, height: 1200 },
        ],
      },
      {
        name: "Germany",
        lat: 51,
        lon: 10,
        height: 800_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "Berlin", landmark: "Brandenburg Gate", country: "Germany", lat: 52.5163, lon: 13.3777, height: 1500 },
          { name: "Munich", landmark: "Marienplatz", country: "Germany", lat: 48.1374, lon: 11.5754, height: 1200 },
        { name: "Hamburg", landmark: "Elbphilharmonie", country: "Germany", lat: 53.5455, lon: 9.981, height: 1500 },
        { name: "Frankfurt", landmark: "Romerberg", country: "Germany", lat: 50.1109, lon: 8.6821, height: 1200 },
        { name: "Cologne", landmark: "Cologne Cathedral", country: "Germany", lat: 50.9413, lon: 6.9583, height: 1200 },
        { name: "Stuttgart", landmark: "Mercedes-Benz Museum", country: "Germany", lat: 48.7833, lon: 9.1833, height: 1200 },
        ],
      },
      {
        name: "Netherlands",
        lat: 52.1,
        lon: 5.3,
        height: 600_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "Amsterdam", landmark: "Rijksmuseum", country: "Netherlands", lat: 52.3600, lon: 4.8852, height: 1500 },
        { name: "Rotterdam", landmark: "Cube Houses", country: "Netherlands", lat: 51.9244, lon: 4.4777, height: 1200 },
        { name: "The Hague", landmark: "Binnenhof", country: "Netherlands", lat: 52.08, lon: 4.3, height: 1200 },
        ],
      },
      {
        name: "Austria",
        lat: 47.6,
        lon: 14.5,
        height: 500_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "Vienna", landmark: "Schönbrunn Palace", country: "Austria", lat: 48.1845, lon: 16.3122, height: 1800 },
        { name: "Salzburg", landmark: "Hohensalzburg Castle", country: "Austria", lat: 47.8095, lon: 13.055, height: 1200 },
        { name: "Innsbruck", landmark: "Golden Roof", country: "Austria", lat: 47.2692, lon: 11.4041, height: 1200 },
        ],
      },
      {
        name: "Czech Republic",
        lat: 49.8,
        lon: 15.5,
        height: 500_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "Prague", landmark: "Charles Bridge", country: "Czech Republic", lat: 50.0865, lon: 14.4114, height: 1200 },
        { name: "Brno", landmark: "Spilberk Castle", country: "Czech Republic", lat: 49.1951, lon: 16.6068, height: 1200 },
        ],
      },
      {
        name: "Portugal",
        lat: 39.4,
        lon: -8.2,
        height: 600_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "Lisbon", landmark: "Belém Tower", country: "Portugal", lat: 38.6916, lon: -9.2156, height: 1500 },
        { name: "Porto", landmark: "Dom Luis I Bridge", country: "Portugal", lat: 41.1407, lon: -8.6112, height: 1200 },
        ],
      },
      {
        name: "Greece",
        lat: 39,
        lon: 22,
        height: 700_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "Athens", landmark: "Acropolis", country: "Greece", lat: 37.9715, lon: 23.7257, height: 1500 },
        { name: "Thessaloniki", landmark: "White Tower", country: "Greece", lat: 40.6401, lon: 22.9444, height: 1200 },
        ],
      },
      {
        name: "Turkey",
        lat: 39,
        lon: 35,
        height: 1_200_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "Istanbul", landmark: "Hagia Sophia", country: "Turkey", lat: 41.0086, lon: 28.9802, height: 1800 },
        { name: "Ankara", landmark: "Anitkabir", country: "Turkey", lat: 39.9255, lon: 32.8669, height: 1500 },
        { name: "Izmir", landmark: "Kemeralti Market", country: "Turkey", lat: 38.4192, lon: 27.1287, height: 1200 },
        { name: "Antalya", landmark: "Hadrian's Gate", country: "Turkey", lat: 36.8841, lon: 30.705, height: 1200 },
        ],
      },
      {
        name: "Denmark",
        lat: 56,
        lon: 9.5,
        height: 500_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "Copenhagen", landmark: "Tivoli", country: "Denmark", lat: 55.6736, lon: 12.5681, height: 1200 },
        { name: "Aarhus", landmark: "ARoS Museum", country: "Denmark", lat: 56.1629, lon: 10.2039, height: 1200 },
        ],
      },
      {
        name: "Sweden",
        lat: 62,
        lon: 15,
        height: 1_200_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "Stockholm", landmark: "Royal Palace", country: "Sweden", lat: 59.3270, lon: 18.0714, height: 1500 },
        { name: "Gothenburg", landmark: "Liseberg", country: "Sweden", lat: 57.7089, lon: 11.9746, height: 1200 },
        { name: "Malmo", landmark: "Turning Torso", country: "Sweden", lat: 55.605, lon: 13.0038, height: 1200 },
        ],
      },
      {
        name: "Norway",
        lat: 62,
        lon: 8,
        height: 1_200_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "Oslo", landmark: "Opera House", country: "Norway", lat: 59.9099, lon: 10.7159, height: 1500 },
        { name: "Bergen", landmark: "Bryggen", country: "Norway", lat: 60.3913, lon: 5.3221, height: 1200 },
        { name: "Trondheim", landmark: "Nidaros Cathedral", country: "Norway", lat: 63.4305, lon: 10.3951, height: 1200 },
        ],
      },
      {
        name: "Ireland",
        lat: 53.4,
        lon: -8,
        height: 500_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "Dublin", landmark: "Trinity College", country: "Ireland", lat: 53.3438, lon: -6.2546, height: 1200 },
        { name: "Cork", landmark: "Blarney Castle", country: "Ireland", lat: 51.8985, lon: -8.4756, height: 1200 },
        ],
      },
      {
        name: "Belgium",
        lat: 50.6,
        lon: 4.7,
        height: 400_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "Brussels", landmark: "Grand-Place", country: "Belgium", lat: 50.8467, lon: 4.3525, height: 1200 },
        { name: "Antwerp", landmark: "Cathedral of Our Lady", country: "Belgium", lat: 51.2194, lon: 4.4025, height: 1200 },
        { name: "Bruges", landmark: "Market Square", country: "Belgium", lat: 51.2093, lon: 3.2247, height: 1000 },
        ],
      },
      {
        name: "Switzerland",
        lat: 46.8,
        lon: 8.2,
        height: 400_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "Zurich", landmark: "Old Town", country: "Switzerland", lat: 47.3769, lon: 8.5417, height: 1200 },
        { name: "Geneva", landmark: "Jet d'Eau", country: "Switzerland", lat: 46.2044, lon: 6.1432, height: 1200 },
        { name: "Basel", landmark: "Basel Minster", country: "Switzerland", lat: 47.5596, lon: 7.5886, height: 1200 },
        ],
      },
      {
        name: "Iceland",
        lat: 64.9,
        lon: -19,
        height: 500_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "Reykjavik", landmark: "Hallgrímskirkja", country: "Iceland", lat: 64.1419, lon: -21.9266, height: 1500 },
        { name: "Akureyri", landmark: "Akureyri Church", country: "Iceland", lat: 65.6835, lon: -18.1262, height: 1200 },
        ],
      },
      {
        name: "Russia",
        lat: 60,
        lon: 90,
        height: 4_000_000,
        heading: 0,
        pitch: -90,
        cities: [
          { name: "Moscow", landmark: "Red Square", country: "Russia", lat: 55.7539, lon: 37.6208, height: 2000 },
          { name: "Saint Petersburg", landmark: "Hermitage", country: "Russia", lat: 59.9398, lon: 30.3146, height: 1800 },
        { name: "Novosibirsk", landmark: "Lenin Square", country: "Russia", lat: 55.0084, lon: 82.9357, height: 1800, osm: true },
        { name: "Yekaterinburg", landmark: "Church on Blood", country: "Russia", lat: 56.8389, lon: 60.6057, height: 1500, osm: true },
        { name: "Vladivostok", landmark: "Golden Horn Bridge", country: "Russia", lat: 43.1155, lon: 131.8855, height: 1500, osm: true },
        { name: "Kazan", landmark: "Kul Sharif Mosque", country: "Russia", lat: 55.7887, lon: 49.1221, height: 1500, osm: true },
        ],
      },
    ],
  },
  {
    name: "Africa",
    lat: 0,
    lon: 20,
    height: 6_000_000,
    heading: 0,
    pitch: -90,
    countries: [
      {
        name: "Egypt",
        lat: 26,
        lon: 30,
        height: 1200000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Cairo", landmark: "Pyramids of Giza", country: "Egypt", lat: 29.9792, lon: 31.1342, height: 2000, osm: true },
        { name: "Alexandria", landmark: "Bibliotheca Alexandrina", country: "Egypt", lat: 31.2089, lon: 29.9092, height: 1500, osm: true },
        { name: "Luxor", landmark: "Valley of the Kings", country: "Egypt", lat: 25.6872, lon: 32.6396, height: 1500, osm: true },
        { name: "Aswan", landmark: "Philae Temple", country: "Egypt", lat: 24.0905, lon: 32.899, height: 1500, osm: true },
        ],
      },
      {
        name: "Nigeria",
        lat: 9,
        lon: 8,
        height: 800000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Lagos", landmark: "Lekki Conservation Centre", country: "Nigeria", lat: 6.4433, lon: 3.4736, height: 2000, osm: true },
        { name: "Abuja", landmark: "Aso Rock", country: "Nigeria", lat: 9.0765, lon: 7.3986, height: 1500, osm: true },
        { name: "Kano", landmark: "City Walls", country: "Nigeria", lat: 12.0022, lon: 8.5919, height: 1500, osm: true },
        ],
      },
      {
        name: "Kenya",
        lat: 0,
        lon: 38,
        height: 600000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Nairobi", landmark: "Nairobi National Park", country: "Kenya", lat: -1.3733, lon: 36.8669, height: 2000, osm: true },
        { name: "Mombasa", landmark: "Fort Jesus", country: "Kenya", lat: -4.0616, lon: 39.6672, height: 1500, osm: true },
        ],
      },
      {
        name: "South Africa",
        lat: -30,
        lon: 24,
        height: 1000000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Cape Town", landmark: "Table Mountain", country: "South Africa", lat: -33.9628, lon: 18.4098, height: 2000, osm: true },
        { name: "Johannesburg", landmark: "Carlton Centre", country: "South Africa", lat: -26.2050, lon: 28.0440, height: 2000, osm: true },
        { name: "Durban", landmark: "uShaka Marine World", country: "South Africa", lat: -29.8587, lon: 31.0218, height: 1500, osm: true },
        { name: "Pretoria", landmark: "Union Buildings", country: "South Africa", lat: -25.746, lon: 28.1881, height: 1500, osm: true },
        ],
      },
      {
        name: "Morocco",
        lat: 32,
        lon: -7,
        height: 700000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Casablanca", landmark: "Hassan II Mosque", country: "Morocco", lat: 33.8900, lon: -6.2608, height: 1500, osm: true },
        { name: "Marrakech", landmark: "Jemaa el-Fnaa", country: "Morocco", lat: 31.6259, lon: -7.9892, height: 1500, osm: true },
        { name: "Fes", landmark: "Fes el Bali", country: "Morocco", lat: 34.0181, lon: -5.0078, height: 1500, osm: true },
        { name: "Tangier", landmark: "Caves of Hercules", country: "Morocco", lat: 35.7595, lon: -5.834, height: 1500, osm: true },
        { name: "Rabat", landmark: "Kasbah of the Udayas", country: "Morocco", lat: 34.0209, lon: -6.8416, height: 1500, osm: true },
        ],
      },
      {
        name: "Ethiopia",
        lat: 9,
        lon: 40,
        height: 800000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Addis Ababa", landmark: "Holy Trinity Cathedral", country: "Ethiopia", lat: 9.0340, lon: 38.7432, height: 2000, osm: true },
        { name: "Lalibela", landmark: "Rock-Hewn Churches", country: "Ethiopia", lat: 12.0319, lon: 39.0473, height: 1500, osm: true },
        ],
      },
      {
        name: "Ghana",
        lat: 8,
        lon: -1,
        height: 400000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Accra", landmark: "Independence Square", country: "Ghana", lat: 5.5587, lon: -0.1757, height: 1500, osm: true },
        { name: "Kumasi", landmark: "Manhyia Palace", country: "Ghana", lat: 6.6884, lon: -1.6244, height: 1500, osm: true },
        ],
      },
      {
        name: "Senegal",
        lat: 14,
        lon: -14,
        height: 400000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Dakar", landmark: "African Renaissance Monument", country: "Senegal", lat: 14.7472, lon: -17.4893, height: 1500, osm: true },
        { name: "Saint-Louis", landmark: "Colonial Architecture", country: "Senegal", lat: 16.0717, lon: -16.493, height: 1500, osm: true },
        ],
      },
      {
        name: "Tanzania",
        lat: -6,
        lon: 35,
        height: 700000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Dar es Salaam", landmark: "Askari Monument", country: "Tanzania", lat: -6.8172, lon: 39.2925, height: 1500, osm: true },
        { name: "Zanzibar", landmark: "Stone Town", country: "Tanzania", lat: -6.1659, lon: 39.2026, height: 1500, osm: true },
        { name: "Arusha", landmark: "Serengeti Gateway", country: "Tanzania", lat: -3.3869, lon: 36.683, height: 1500, osm: true },
        ],
      },
      {
        name: "Tunisia",
        lat: 34,
        lon: 9,
        height: 400000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Tunis", landmark: "Medina of Tunis", country: "Tunisia", lat: 36.7988, lon: 10.1780, height: 1500, osm: true },
        { name: "Sfax", landmark: "Medina of Sfax", country: "Tunisia", lat: 34.7406, lon: 10.7604, height: 1200, osm: true },
        { name: "Carthage", landmark: "Ruins of Carthage", country: "Tunisia", lat: 36.8528, lon: 10.3236, height: 1200, osm: true },
        ],
      },
      {
        name: "Algeria",
        lat: 34,
        lon: 3,
        height: 1200000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Algiers", landmark: "Notre-Dame d'Afrique", country: "Algeria", lat: 36.7400, lon: 3.0600, height: 1800, osm: true },
        { name: "Oran", landmark: "Santa Cruz Fort", country: "Algeria", lat: 35.6969, lon: -0.6331, height: 1500, osm: true },
        { name: "Constantine", landmark: "Sidi M'Cid Bridge", country: "Algeria", lat: 36.365, lon: 6.6147, height: 1500, osm: true },
        ],
      },
    ],
  },
  {
    name: "Asia",
    lat: 35,
    lon: 95,
    height: 5_000_000,
    heading: 0,
    pitch: -90,
    countries: [
      {
        name: "Japan",
        lat: 36,
        lon: 138,
        height: 800000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Tokyo", landmark: "Tokyo Tower", country: "Japan", lat: 35.6586, lon: 139.7454, height: 1500, heading: 0, pitch: -35 },
        { name: "Kyoto", landmark: "Fushimi Inari Shrine", country: "Japan", lat: 35.0116, lon: 135.7681, height: 1500, heading: 0, pitch: -35 },
        { name: "Osaka", landmark: "Osaka Castle", country: "Japan", lat: 34.6937, lon: 135.5023, height: 1500, heading: 0, pitch: -35 },
        { name: "Nagoya", landmark: "Nagoya Castle", country: "Japan", lat: 35.1815, lon: 136.9066, height: 1500 },
        { name: "Sapporo", landmark: "Sapporo Clock Tower", country: "Japan", lat: 43.0618, lon: 141.3545, height: 1500 },
        { name: "Fukuoka", landmark: "Fukuoka Castle", country: "Japan", lat: 33.5904, lon: 130.4017, height: 1200 },
        { name: "Yokohama", landmark: "Landmark Tower", country: "Japan", lat: 35.4437, lon: 139.638, height: 1500 },
        ],
      },
      {
        name: "Singapore",
        lat: 1.3,
        lon: 103.8,
        height: 300000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Singapore", landmark: "Marina Bay Sands", country: "Singapore", lat: 1.2834, lon: 103.8607, height: 1800, heading: 0, pitch: -35 },
        ],
      },
      {
        name: "China",
        lat: 35,
        lon: 105,
        height: 3000000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Hong Kong", landmark: "Victoria Harbour", country: "China", lat: 22.3193, lon: 114.1694, height: 2000, heading: 0, pitch: -35 },
        { name: "Shanghai", landmark: "The Bund", country: "China", lat: 31.2397, lon: 121.4900, height: 1800 },
        { name: "Beijing", landmark: "Forbidden City", country: "China", lat: 39.9163, lon: 116.3972, height: 1800 },
        { name: "Guangzhou", landmark: "Canton Tower", country: "China", lat: 23.1291, lon: 113.2644, height: 1800 },
        { name: "Shenzhen", landmark: "Ping An Finance Centre", country: "China", lat: 22.5431, lon: 114.0579, height: 1800 },
        { name: "Chengdu", landmark: "Giant Panda Center", country: "China", lat: 30.5728, lon: 104.0668, height: 1800 },
        { name: "Xi'an", landmark: "Terracotta Army", country: "China", lat: 34.3416, lon: 108.9398, height: 1800 },
        { name: "Nanjing", landmark: "Sun Yat-sen Mausoleum", country: "China", lat: 32.0603, lon: 118.7969, height: 1500 },
        { name: "Hangzhou", landmark: "West Lake", country: "China", lat: 30.2741, lon: 120.1551, height: 1500 },
        ],
      },
      {
        name: "UAE",
        lat: 24,
        lon: 54,
        height: 400000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Dubai", landmark: "Burj Khalifa", country: "UAE", lat: 25.1972, lon: 55.2744, height: 2000, heading: 0, pitch: -35, osm: true },
        { name: "Abu Dhabi", landmark: "Sheikh Zayed Mosque", country: "UAE", lat: 24.4139, lon: 54.4869, height: 1800, osm: true },
        { name: "Sharjah", landmark: "Al Noor Mosque", country: "UAE", lat: 25.3573, lon: 55.4033, height: 1200, osm: true },
        ],
      },
      {
        name: "Saudi Arabia",
        lat: 24,
        lon: 45,
        height: 1500000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Mecca", landmark: "Masjid al-Haram", country: "Saudi Arabia", lat: 21.3891, lon: 39.8579, height: 1800, heading: 0, pitch: -35, osm: true },
        { name: "Medina", landmark: "Prophet's Mosque", country: "Saudi Arabia", lat: 24.5247, lon: 39.5692, height: 1800, heading: 0, pitch: -35, osm: true },
        { name: "Riyadh", landmark: "Kingdom Centre", country: "Saudi Arabia", lat: 24.7136, lon: 46.6753, height: 1800, osm: true },
        { name: "Jeddah", landmark: "King Fahd Fountain", country: "Saudi Arabia", lat: 21.4858, lon: 39.1925, height: 1800, osm: true },
        ],
      },
      {
        name: "Indonesia",
        lat: -2,
        lon: 118,
        height: 2000000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Jakarta", landmark: "National Monument", country: "Indonesia", lat: -6.1865, lon: 106.823, height: 2500, heading: 20, pitch: -35, osm: true },
        { name: "Bali", landmark: "Tanah Lot Temple", country: "Indonesia", lat: -8.6705, lon: 115.2126, height: 3000, heading: 0, pitch: -35, osm: true },
        { name: "Surabaya", landmark: "Hero Monument", country: "Indonesia", lat: -7.2575, lon: 112.7521, height: 1800, osm: true },
        { name: "Bandung", landmark: "Gedung Sate", country: "Indonesia", lat: -6.9175, lon: 107.6191, height: 1500, osm: true },
        { name: "Medan", landmark: "Maimun Palace", country: "Indonesia", lat: 3.5952, lon: 98.6722, height: 1500, osm: true },
        { name: "Makassar", landmark: "Fort Rotterdam", country: "Indonesia", lat: -5.1477, lon: 119.4327, height: 1500, osm: true },
        { name: "Yogyakarta", landmark: "Borobudur Temple", country: "Indonesia", lat: -7.7956, lon: 110.3695, height: 1500, osm: true },
        { name: "Semarang", landmark: "Lawang Sewu", country: "Indonesia", lat: -6.9667, lon: 110.4167, height: 1500, osm: true },
        ],
      },
      {
        name: "South Korea",
        lat: 36.5,
        lon: 127.8,
        height: 500000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Seoul", landmark: "Gyeongbokgung Palace", country: "South Korea", lat: 37.5796, lon: 126.9770, height: 1500 },
        { name: "Busan", landmark: "Haeundae Beach", country: "South Korea", lat: 35.1587, lon: 129.16, height: 1500 },
        { name: "Incheon", landmark: "Incheon Bridge", country: "South Korea", lat: 37.4563, lon: 126.7052, height: 1200 },
        { name: "Daegu", landmark: "Donghwasa Temple", country: "South Korea", lat: 35.8714, lon: 128.6014, height: 1200 },
        ],
      },
      {
        name: "Taiwan",
        lat: 23.7,
        lon: 121,
        height: 300000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Taipei", landmark: "Taipei 101", country: "Taiwan", lat: 25.0336, lon: 121.5645, height: 1800 },
        { name: "Kaohsiung", landmark: "Dragon and Tiger Pagodas", country: "Taiwan", lat: 22.6273, lon: 120.3014, height: 1200 },
        ],
      },
      {
        name: "Thailand",
        lat: 15,
        lon: 101,
        height: 700000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Bangkok", landmark: "Grand Palace", country: "Thailand", lat: 13.7500, lon: 100.4914, height: 1500, osm: true },
        { name: "Chiang Mai", landmark: "Doi Suthep Temple", country: "Thailand", lat: 18.7883, lon: 98.9853, height: 1500, osm: true },
        { name: "Phuket", landmark: "Big Buddha", country: "Thailand", lat: 7.8804, lon: 98.3923, height: 1500, osm: true },
        { name: "Pattaya", landmark: "Sanctuary of Truth", country: "Thailand", lat: 12.9236, lon: 100.8825, height: 1200, osm: true },
        ],
      },
      {
        name: "Vietnam",
        lat: 16,
        lon: 107,
        height: 800000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Hanoi", landmark: "Hoan Kiem Lake", country: "Vietnam", lat: 21.0285, lon: 105.8542, height: 1200, osm: true },
        { name: "Ho Chi Minh City", landmark: "Notre-Dame Cathedral", country: "Vietnam", lat: 10.7797, lon: 106.6990, height: 1500, osm: true },
        { name: "Da Nang", landmark: "Dragon Bridge", country: "Vietnam", lat: 16.0544, lon: 108.2022, height: 1200, osm: true },
        { name: "Hue", landmark: "Imperial City", country: "Vietnam", lat: 16.4637, lon: 107.5909, height: 1200, osm: true },
        ],
      },
      {
        name: "Philippines",
        lat: 13,
        lon: 122,
        height: 800000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Manila", landmark: "Intramuros", country: "Philippines", lat: 14.5915, lon: 120.9747, height: 1500, osm: true },
        { name: "Cebu", landmark: "Magellan's Cross", country: "Philippines", lat: 10.3157, lon: 123.8854, height: 1200, osm: true },
        { name: "Davao", landmark: "Mount Apo", country: "Philippines", lat: 7.1907, lon: 125.4553, height: 1500, osm: true },
        ],
      },
      {
        name: "Malaysia",
        lat: 4,
        lon: 102,
        height: 500000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Kuala Lumpur", landmark: "Petronas Towers", country: "Malaysia", lat: 3.1578, lon: 101.7117, height: 1800, osm: true },
        { name: "George Town", landmark: "Kek Lok Si Temple", country: "Malaysia", lat: 5.4141, lon: 100.3288, height: 1200, osm: true },
        { name: "Johor Bahru", landmark: "Sultan Abu Bakar Mosque", country: "Malaysia", lat: 1.4927, lon: 103.7414, height: 1200, osm: true },
        ],
      },
      {
        name: "India",
        lat: 22,
        lon: 79,
        height: 2500000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Mumbai", landmark: "Gateway of India", country: "India", lat: 18.9220, lon: 72.8347, height: 1800 },
        { name: "Delhi", landmark: "Red Fort", country: "India", lat: 28.6562, lon: 77.2410, height: 1800 },
        { name: "Agra", landmark: "Taj Mahal", country: "India", lat: 27.1751, lon: 78.0421, height: 1500 },
        { name: "Jaipur", landmark: "Hawa Mahal", country: "India", lat: 26.9239, lon: 75.8267, height: 1500 },
        { name: "Bangalore", landmark: "Bangalore Palace", country: "India", lat: 12.9784, lon: 77.6408, height: 1800 },
        { name: "Chennai", landmark: "Marina Beach", country: "India", lat: 13.0827, lon: 80.2707, height: 1800 },
        { name: "Kolkata", landmark: "Victoria Memorial", country: "India", lat: 22.5448, lon: 88.3426, height: 1800 },
        { name: "Hyderabad", landmark: "Charminar", country: "India", lat: 17.3606, lon: 78.4749, height: 1800 },
        { name: "Varanasi", landmark: "Ghats", country: "India", lat: 25.3176, lon: 82.9739, height: 1500 },
        { name: "Goa", landmark: "Basilica of Bom Jesus", country: "India", lat: 15.4909, lon: 73.8278, height: 1500 },
        ],
      },
      {
        name: "Pakistan",
        lat: 30,
        lon: 70,
        height: 1000000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Karachi", landmark: "Mazar-e-Quaid", country: "Pakistan", lat: 24.8747, lon: 67.0391, height: 1800, osm: true },
        { name: "Lahore", landmark: "Badshahi Mosque", country: "Pakistan", lat: 31.5889, lon: 74.3073, height: 1500, osm: true },
        { name: "Islamabad", landmark: "Faisal Mosque", country: "Pakistan", lat: 33.6844, lon: 73.0479, height: 1500, osm: true },
        { name: "Faisalabad", landmark: "Clock Tower", country: "Pakistan", lat: 31.4504, lon: 73.135, height: 1500, osm: true },
        ],
      },
      {
        name: "Bangladesh",
        lat: 24,
        lon: 90,
        height: 400000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Dhaka", landmark: "Lalbagh Fort", country: "Bangladesh", lat: 23.7183, lon: 90.3877, height: 1500, osm: true },
        { name: "Chittagong", landmark: "Shrine of Bayejid Bostami", country: "Bangladesh", lat: 22.3569, lon: 91.7832, height: 1500, osm: true },
        ],
      },
      {
        name: "Sri Lanka",
        lat: 7,
        lon: 81,
        height: 300000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Colombo", landmark: "Galle Face Green", country: "Sri Lanka", lat: 6.9271, lon: 79.8448, height: 1500, osm: true },
        { name: "Kandy", landmark: "Temple of the Tooth", country: "Sri Lanka", lat: 7.2906, lon: 80.6337, height: 1500, osm: true },
        { name: "Galle", landmark: "Galle Fort", country: "Sri Lanka", lat: 6.0535, lon: 80.221, height: 1200, osm: true },
        ],
      },
      {
        name: "Cambodia",
        lat: 12.5,
        lon: 105,
        height: 400000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Phnom Penh", landmark: "Royal Palace", country: "Cambodia", lat: 11.5645, lon: 104.9259, height: 1200, osm: true },
        { name: "Siem Reap", landmark: "Angkor Wat", country: "Cambodia", lat: 13.4125, lon: 103.867, height: 1500, osm: true },
        ],
      },
      {
        name: "Myanmar",
        lat: 21,
        lon: 96,
        height: 700000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Yangon", landmark: "Shwedagon Pagoda", country: "Myanmar", lat: 16.7984, lon: 96.1496, height: 1500, osm: true },
        { name: "Mandalay", landmark: "Mandalay Palace", country: "Myanmar", lat: 21.9588, lon: 96.0917, height: 1500, osm: true },
        { name: "Naypyidaw", landmark: "Uppatasanti Pagoda", country: "Myanmar", lat: 19.7633, lon: 96.0785, height: 1500, osm: true },
        ],
      },
      {
        name: "Mongolia",
        lat: 47,
        lon: 105,
        height: 1200000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Ulaanbaatar", landmark: "Sükhbaatar Square", country: "Mongolia", lat: 47.9184, lon: 106.9176, height: 1500, osm: true },
        ],
      },
      {
        name: "Israel",
        lat: 31.5,
        lon: 34.8,
        height: 200000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Tel Aviv", landmark: "White City", country: "Israel", lat: 32.0809, lon: 34.7806, height: 1500 },
        { name: "Jerusalem", landmark: "Old City", country: "Israel", lat: 31.7780, lon: 35.2269, height: 1500 },
        { name: "Haifa", landmark: "Baha'i Gardens", country: "Israel", lat: 32.81, lon: 34.98, height: 1200 },
        ],
      },
      {
        name: "Qatar",
        lat: 25.3,
        lon: 51.2,
        height: 200000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Doha", landmark: "Museum of Islamic Art", country: "Qatar", lat: 25.2972, lon: 51.5366, height: 1500 },
        ],
      },
      {
        name: "Nepal",
        lat: 28,
        lon: 84,
        height: 400000,
        heading: 0,
        pitch: -90,
        cities: [
        { name: "Kathmandu", landmark: "Boudhanath Stupa", country: "Nepal", lat: 27.7215, lon: 85.3620, height: 1500, osm: true },
        { name: "Pokhara", landmark: "Phewa Lake", country: "Nepal", lat: 28.2096, lon: 83.9856, height: 1500, osm: true },
        ],
      },
    ],
  },
];

const PANEL_WIDTH = 240;

export default function CityBookmarks({ visible = true }: Props) {
  const [mounted, setMounted] = useState(false);
  const panelOpen = useGlobeStore((s) => s.rightPanelOpen);
  const setPanelOpen = useGlobeStore((s) => s.setRightPanelOpen);

  const activeCity = useGlobeStore((s) => s.activeCity);
  const savedViews = useGlobeStore((s) => s.savedViews);
  const setActiveCity = useGlobeStore((s) => s.setActiveCity);

  // When the PRIVATE FLIGHTS layer is on, the right panel shows the private
  // flights search/feed instead of the continental menu (way back = toggle
  // the layer off, which PrivateFlightsPanel offers as ‹ CONTINENTS).
  const flightsOn = useGlobeStore((s) => s.layerVisibility.flights ?? false);
  const cctvOn = useGlobeStore((s) => s.layerVisibility.cctv ?? false);
  const cctvSources = useGlobeStore((s) => s.cctvSources);
  const cctvSourceCounts = useGlobeStore((s) => s.cctvSourceCounts);
  const toggleCctvSource = useGlobeStore((s) => s.toggleCctvSource);

  // null = continents list view; otherwise the continent name whose
  // countries are currently shown in the panel.
  const [selectedContinent, setSelectedContinent] = useState<string | null>(null);
  // null = countries list view; otherwise the country name whose cities
  // are currently shown in the panel.
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  function flyToCity(city: CityBookmark) {
    const v = (window as unknown as { __viewer?: Cesium.Viewer }).__viewer;
    if (!v || v.isDestroyed()) return;

    // Use saved view if one exists for this city, otherwise use default.
    const saved = savedViews[city.name];
    const view: SavedView = saved ?? {
      lat: city.lat,
      lon: city.lon,
      height: city.height,
      heading: city.heading ?? 0,
      pitch: city.pitch ?? -35,
    };

    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(view.lon, view.lat, view.height),
      orientation: {
        heading: Cesium.Math.toRadians(view.heading),
        pitch: Cesium.Math.toRadians(view.pitch),
        roll: 0,
      },
      duration: 1.8,
    });
    setActiveCity(city.name);
  }

  function flyToContinent(continent: Continent) {
    const v = (window as unknown as { __viewer?: Cesium.Viewer }).__viewer;
    if (!v || v.isDestroyed()) return;
    const saved = savedViews[continent.name];
    const view: SavedView = saved ?? {
      lat: continent.lat,
      lon: continent.lon,
      height: continent.height,
      heading: continent.heading ?? 0,
      pitch: continent.pitch ?? -90,
    };
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(view.lon, view.lat, view.height),
      orientation: {
        heading: Cesium.Math.toRadians(view.heading),
        pitch: Cesium.Math.toRadians(view.pitch),
        roll: 0,
      },
      duration: 1.8,
    });
    setActiveCity(continent.name);
    // Also drill into the countries list so the panel shows this continent's
    // countries instead of staying on the full continents list.
    setSelectedCountry(null);
    setSelectedContinent(continent.name);
  }

  function flyToCountry(country: Country) {
    const v = (window as unknown as { __viewer?: Cesium.Viewer }).__viewer;
    if (!v || v.isDestroyed()) return;
    const saved = savedViews[country.name];
    const view: SavedView = saved ?? {
      lat: country.lat,
      lon: country.lon,
      height: country.height,
      heading: country.heading ?? 0,
      pitch: country.pitch ?? -90,
    };
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(view.lon, view.lat, view.height),
      orientation: {
        heading: Cesium.Math.toRadians(view.heading),
        pitch: Cesium.Math.toRadians(view.pitch),
        roll: 0,
      },
      duration: 1.8,
    });
    setActiveCity(country.name);
  }

  if (!visible || !mounted) return null;

  // The continent currently being browsed (null = continents list view).
  const currentContinent = selectedContinent
    ? CONTINENTS.find((c) => c.name === selectedContinent) ?? null
    : null;

  // The country currently being browsed (null = countries list view).
  const currentCountry =
    currentContinent && selectedCountry
      ? currentContinent.countries.find((co) => co.name === selectedCountry) ?? null
      : null;

  // The continent that contains the active city — highlighted in the
  // continents list view so the user knows where they currently are.
  const activeContinent = activeCity
    ? CONTINENTS.find((c) =>
        c.countries.some((co) => co.cities.some((ci) => ci.name === activeCity)),
      )?.name ?? null
    : null;

  // The country that contains the active city — highlighted in the
  // countries list view.
  const activeCountry =
    currentContinent && activeCity
      ? currentContinent.countries.find((co) =>
          co.cities.some((ci) => ci.name === activeCity),
        )?.name ?? null
      : null;

  // Shared row styling — mirrors the look of the left TacticalHUD sidebar.
  // Text is right-aligned so the panel content hugs the right edge like the
  // coordinates readout below it.
  function rowStyle(isActive: boolean): React.CSSProperties {
    return {
      width: "100%",
      padding: "8px 10px",
      background: isActive
        ? "rgba(0, 212, 255, 0.12)"
        : "transparent",
      border: isActive
        ? "1px solid rgba(0, 212, 255, 0.6)"
        : "1px solid rgba(0, 212, 255, 0.15)",
      color: isActive ? "#00D4FF" : "#5ab3d4",
      fontSize: 10,
      fontFamily: "inherit",
      cursor: "pointer",
      textAlign: "right",
      borderRadius: 6,
      letterSpacing: 0.5,
      transition: "background 0.15s, border-color 0.15s, color 0.15s",
      marginBottom: 4,
    };
  }

  function hoverOn(e: React.MouseEvent<HTMLElement>) {
    e.currentTarget.style.background = "rgba(0, 212, 255, 0.08)";
    e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.2)";
    e.currentTarget.style.color = "#00D4FF";
  }
  function hoverOff(e: React.MouseEvent<HTMLElement>, isActive: boolean) {
    if (isActive) return;
    e.currentTarget.style.background = "rgba(0, 212, 255, 0.03)";
    e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.15)";
    e.currentTarget.style.color = "#5ab3d4";
  }

  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: panelOpen ? PANEL_WIDTH : 0,
          height: "100%",
          background: "transparent",
          borderLeft: "none",
          // Curve the inner (left) edge to mirror the left sidebar.
          borderTopLeftRadius: panelOpen ? 18 : 0,
          borderBottomLeftRadius: panelOpen ? 18 : 0,
          transition: "width 0.2s ease",
          zIndex: 60,
          overflow: "hidden",
          fontFamily: "JetBrains Mono, monospace",
          color: "#9fe9ff",
          pointerEvents: "auto",
        }}
      >
        {panelOpen && flightsOn ? (
          <PrivateFlightsPanel />
        ) : panelOpen && cctvOn ? (
          <div className="scrollbar" style={{ padding: "16px 12px 120px 12px", height: "100%", overflowY: "auto" }}>
            <div
              style={{
                fontSize: 8,
                letterSpacing: 1.5,
                marginBottom: 10,
                color: "#7ac4e0",
                textAlign: "right",
              }}
            >
              CCTV SOURCES {activeCity ? `· ${activeCity.toUpperCase()}` : ""}
            </div>
            <CctvSourceList
              cctvSources={cctvSources}
              cctvSourceCounts={cctvSourceCounts}
              activeCity={activeCity}
              toggleCctvSource={toggleCctvSource}
              hoverOn={hoverOn}
              hoverOff={hoverOff}
              rowStyle={rowStyle}
            />
          </div>
        ) : (
          <div className="scrollbar" style={{ padding: "16px 12px", height: "100%", overflowY: "auto" }}>
            {currentCountry ? (
              <>
                {/* Back button — returns to the countries list view */}
                <button
                  onClick={() => setSelectedCountry(null)}
                  style={{
                    width: "100%",
                    padding: "5px 8px",
                    background: "rgba(0, 212, 255, 0.03)",
                    border: "1px solid rgba(0, 212, 255, 0.2)",
                    color: "#7ac4e0",
                    fontSize: 9,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    textAlign: "right",
                    borderRadius: 6,
                    marginBottom: 8,
                    letterSpacing: 1,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(0, 212, 255, 0.08)";
                    e.currentTarget.style.color = "#00D4FF";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(0, 212, 255, 0.03)";
                    e.currentTarget.style.color = "#7ac4e0";
                  }}
                >
                  ‹ BACK
                </button>
                <div
                  style={{
                    fontSize: 8,
                    letterSpacing: 1.5,
                    marginBottom: 10,
                    color: "#7ac4e0",
                    textAlign: "right",
                  }}
                >
                  {currentCountry.name.toUpperCase()}
                </div>
                <div
                  className="scrollbar"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    maxHeight: 440,
                    overflowY: "auto",
                  }}
                >
                  {currentCountry.cities
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((city) => {
                    const isActive = activeCity === city.name;
                    return (
                      <button
                        key={city.name}
                        onClick={() => flyToCity(city)}
                        style={rowStyle(isActive)}
                        onMouseEnter={(e) => hoverOn(e)}
                        onMouseLeave={(e) => hoverOff(e, isActive)}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: 6,
                          }}
                        >
                          <span>{city.name.toUpperCase()}</span>
                          {city.osm && (
                            <span
                              style={{
                                fontSize: 8,
                                letterSpacing: 1,
                                opacity: 0.6,
                                color: isActive ? "#00D4FF" : "#5ab3d4",
                              }}
                            >
                              (OSM)
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : currentContinent ? (
              <>
                {/* Back button — returns to the continents list view */}
                <button
                  onClick={() => setSelectedContinent(null)}
                  style={{
                    width: "100%",
                    padding: "5px 8px",
                    background: "rgba(0, 212, 255, 0.03)",
                    border: "1px solid rgba(0, 212, 255, 0.2)",
                    color: "#7ac4e0",
                    fontSize: 9,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    textAlign: "right",
                    borderRadius: 6,
                    marginBottom: 8,
                    letterSpacing: 1,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(0, 212, 255, 0.08)";
                    e.currentTarget.style.color = "#00D4FF";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(0, 212, 255, 0.03)";
                    e.currentTarget.style.color = "#7ac4e0";
                  }}
                >
                  ‹ BACK
                </button>
                <div
                  style={{
                    fontSize: 8,
                    letterSpacing: 1.5,
                    marginBottom: 10,
                    color: "#7ac4e0",
                    textAlign: "right",
                  }}
                >
                  {currentContinent.name.toUpperCase()}
                </div>
                <div
                  className="scrollbar"
                  style={{ display: "flex", flexDirection: "column", maxHeight: 340, overflowY: "auto" }}
                >
                  {currentContinent.countries
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((country) => {
                    const isActive = activeCountry === country.name;
                    return (
                      <div
                        key={country.name}
                        style={{
                          ...rowStyle(isActive),
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          padding: 0,
                        }}
                      >
                        {/* Click the country name → fly to country view */}
                        <button
                          onClick={() => flyToCountry(country)}
                          onMouseEnter={(e) => hoverOn(e)}
                          onMouseLeave={(e) => hoverOff(e, isActive)}
                          style={{
                            flex: 1,
                            background: "transparent",
                            border: "none",
                            color: isActive ? "#00D4FF" : "#5ab3d4",
                            fontSize: 10,
                            fontFamily: "inherit",
                            cursor: "pointer",
                            textAlign: "right",
                            padding: "8px 0 8px 10px",
                            letterSpacing: 0.5,
                            outline: "none",
                          }}
                          title={`Fly to ${country.name} country view`}
                        >
                          {country.name.toUpperCase()}
                        </button>
                        {/* Click the arrow → drill into cities of this country */}
                        <button
                          onClick={() => setSelectedCountry(country.name)}
                          onMouseEnter={(e) => hoverOn(e)}
                          onMouseLeave={(e) => hoverOff(e, isActive)}
                          title={`Browse cities in ${country.name}`}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: isActive ? "#00D4FF" : "#5ab3d4",
                            fontSize: 12,
                            fontFamily: "inherit",
                            cursor: "pointer",
                            padding: "8px 10px",
                            lineHeight: 1,
                            outline: "none",
                          }}
                        >
                          ›
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    fontSize: 8,
                    letterSpacing: 1.5,
                    marginBottom: 10,
                    color: "#7ac4e0",
                    textAlign: "right",
                  }}
                >
                  CONTINENTS
                </div>
                <div
                  className="scrollbar"
                  style={{ display: "flex", flexDirection: "column", maxHeight: 340, overflowY: "auto" }}
                >
                  {CONTINENTS.map((continent) => {
                    const isActive = activeContinent === continent.name;
                    return (
                      <div
                        key={continent.name}
                        style={{
                          ...rowStyle(isActive),
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          padding: 0,
                        }}
                      >
                        {/* Click the continent name → fly to continental view */}
                        <button
                          onClick={() => flyToContinent(continent)}
                          onMouseEnter={(e) => hoverOn(e)}
                          onMouseLeave={(e) => hoverOff(e, isActive)}
                          style={{
                            flex: 1,
                            background: "transparent",
                            border: "none",
                            color: isActive ? "#00D4FF" : "#5ab3d4",
                            fontSize: 10,
                            fontFamily: "inherit",
                            cursor: "pointer",
                            textAlign: "right",
                            padding: "8px 0 8px 10px",
                            letterSpacing: 0.5,
                            outline: "none",
                          }}
                          title={`Fly to ${continent.name} continental view`}
                        >
                          {continent.name.toUpperCase()}
                        </button>
                        {/* Click the arrow → drill into countries of this continent */}
                        <button
                          onClick={() => setSelectedContinent(continent.name)}
                          onMouseEnter={(e) => hoverOn(e)}
                          onMouseLeave={(e) => hoverOff(e, isActive)}
                          title={`Browse countries in ${continent.name}`}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: isActive ? "#00D4FF" : "#5ab3d4",
                            fontSize: 12,
                            fontFamily: "inherit",
                            cursor: "pointer",
                            padding: "8px 10px",
                            lineHeight: 1,
                            outline: "none",
                          }}
                        >
                          ›
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
