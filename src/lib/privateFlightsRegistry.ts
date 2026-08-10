// Registry of notable public figures mapped to their known aircraft tail
// numbers.
//
// All tail numbers listed here are PUBLIC aircraft registration identifiers
// published in FAA / civil aviation authority registries (e.g. the FAA
// Aircraft Registry at registry.faa.gov) and widely reported in mainstream
// press. This is NOT doxxing - these are public regulatory records for
// aircraft that, by law, broadcast their position via ADS-B on the open
// 1090 MHz band. Tracking them is the same as reading a license plate.
//
// Source: FAA Aircraft Registry + OpenSky Network metadata. Tail numbers
// may change as aircraft are sold/re-registered; this list is a best-effort
// snapshot for OSINT purposes.

export interface NotablePerson {
  name: string;
  tailNumbers: string[];
  description?: string;
}

export const NOTABLE_PEOPLE: NotablePerson[] = [
  {
    name: "Elon Musk",
    tailNumbers: ["N628TS", "N272BG", "N502SX", "N404SX"],
    description: "SpaceX / Tesla CEO. Multiple Gulfstream G650ER + G550.",
  },
  {
    name: "Bill Gates",
    tailNumbers: ["N767QS", "N194WM", "N887WM"],
    description: "Gates Foundation. Bombardier Global Express fleet.",
  },
  {
    name: "Mark Zuckerberg",
    tailNumbers: ["N3767"],
    description: "Meta CEO. Gulfstream G650.",
  },
  {
    name: "Jeff Bezos",
    tailNumbers: ["N2711", "N856WM"],
    description: "Amazon / Blue Origin founder. Gulfstream G650ER.",
  },
  {
    name: "Michael Bloomberg",
    tailNumbers: ["N3355"],
    description: "Bloomberg LP founder. Gulfstream G650.",
  },
  {
    name: "Donald Trump",
    tailNumbers: ["N757AF", "N725DT"],
    description: "Trump Force One. Boeing 757 + Cessna Citation.",
  },
  {
    name: "Roman Abramovich",
    tailNumbers: ["P4-MES", "LX-RAY"],
    description: "Former Chelsea FC owner. Boeing 787-8 + Gulfstream G650.",
  },
  {
    name: "Saudi Royal Family",
    tailNumbers: ["HZ-MY1", "HZ-MY2", "HZ-MS1"],
    description: "House of Saud VIP fleet. Boeing 747-8 + 747-400.",
  },
  {
    name: "Larry Page",
    tailNumbers: ["N221LG", "N222LG"],
    description: "Google co-founder. Boeing 767-200 + Gulfstream.",
  },
  {
    name: "Sergey Brin",
    tailNumbers: ["N221LG", "N222LG"],
    description: "Google co-founder. Shares Google founder fleet.",
  },
  {
    name: "Warren Buffett",
    tailNumbers: ["N702QS", "N798QS"],
    description: "Berkshire Hathaway. NetJets fractional fleet.",
  },
  {
    name: "Tim Cook",
    tailNumbers: ["N5003"],
    description: "Apple CEO. Gulfstream G650.",
  },
  {
    name: "Bill Clinton",
    tailNumbers: ["N700QS"],
    description: "Former US President. NetJets charter.",
  },
  {
    name: "George Soros",
    tailNumbers: ["N5500P"],
    description: "Soros Fund Management. Gulfstream G650.",
  },
  {
    name: "Paul Allen Estate",
    tailNumbers: ["N757PX"],
    description: "Late Microsoft co-founder. Boeing 757 - now estate-managed.",
  },
  {
    name: "Taylor Swift",
    tailNumbers: ["N898TS"],
    description: "Singer. Gulfstream G650ER.",
  },
  {
    name: "Jay-Z",
    tailNumbers: ["N898KY"],
    description: "Rapper / entrepreneur. Gulfstream G650ER.",
  },
  {
    name: "Mark Cuban",
    tailNumbers: ["N594MC"],
    description: "Shark Tank / Dallas Mavericks. Boeing 767-200ER.",
  },
  {
    name: "Oprah Winfrey",
    tailNumbers: ["N540W"],
    description: "Media mogul. Gulfstream G650.",
  },
  {
    name: "Rupert Murdoch",
    tailNumbers: ["N894MM"],
    description: "News Corp / Fox founder. Gulfstream G650.",
  },
  {
    name: "Phil Knight",
    tailNumbers: ["N595KN"],
    description: "Nike founder. Gulfstream G650ER.",
  },
  {
    name: "Robert Kraft",
    tailNumbers: ["N988NE"],
    description: "New England Patriots owner. Gulfstream G550.",
  },
  {
    name: "David Geffen",
    tailNumbers: ["N688GD"],
    description: "DreamWorks co-founder. Gulfstream G650ER.",
  },
  {
    name: "Michael Dell",
    tailNumbers: ["N747MW"],
    description: "Dell Technologies founder. Gulfstream G650.",
  },
  {
    name: "Peter Thiel",
    tailNumbers: ["N250PT"],
    description: "PayPal / Palantir co-founder. Gulfstream G650ER.",
  },
  {
    name: "Carl Icahn",
    tailNumbers: ["N903CI"],
    description: "Activist investor. Gulfstream G650.",
  },
];
