// The constellations: how big each is, who drew it, its story, and some things
// worked out from the sky: when the Sun is really in front of it, when it's best
// seen, and how much of it you can see from where you are.

import * as A from "astronomy-engine";

// From the IAU's boundaries: [area (square degrees), rank by area (1 is biggest),
// centre RA, centre Dec (degrees, J2000: the middle of its furthest extents)].
// Serpens is in two pieces: its area is both together, its centre the head's.
const AREAS = {
  And: [722.278, 19, 12.12, 37.43],
  Ant: [238.901, 62, 154.11, -32.48],
  Aps: [206.327, 67, 242.16, -75.3],
  Aql: [652.473, 22, 295.0, 3.41],
  Aqr: [979.854, 10, 334.34, -10.79],
  Ara: [237.057, 63, 260.62, -56.59],
  Ari: [441.395, 39, 39.54, 20.79],
  Aur: [657.438, 21, 91.11, 42.03],
  Boo: [906.831, 13, 220.66, 31.2],
  Cae: [124.865, 81, 70.57, -37.88],
  Cam: [756.828, 18, 132.84, 69.38],
  Cap: [413.947, 40, 315.73, -18.02],
  Car: [494.184, 34, 130.43, -63.22],
  Cas: [598.407, 25, 19.79, 62.18],
  Cen: [1060.422, 9, 196.07, -47.35],
  Cep: [587.787, 27, 38.16, 71.01],
  Cet: [1231.411, 4, 25.03, -7.18],
  Cha: [131.592, 79, 160.38, -79.2],
  Cir: [93.353, 85, 218.63, -63.03],
  CMa: [380.118, 43, 102.44, -22.14],
  CMi: [183.367, 71, 114.79, 6.43],
  Cnc: [505.872, 31, 129.74, 19.81],
  Col: [270.184, 54, 87.94, -35.09],
  Com: [386.475, 42, 191.82, 23.31],
  CrA: [127.696, 80, 279.7, -41.15],
  CrB: [178.71, 73, 237.65, 32.62],
  Crt: [282.398, 53, 170.94, -15.93],
  Cru: [68.447, 88, 186.75, -60.19],
  Crv: [183.801, 70, 186.63, -18.44],
  CVn: [465.194, 38, 196.74, 40.1],
  Cyg: [803.983, 16, 308.82, 44.55],
  Del: [188.549, 69, 310.4, 11.67],
  Dor: [179.173, 72, 78.63, -59.39],
  Dra: [1082.952, 8, 227.16, 67.01],
  Equ: [71.641, 87, 317.81, 7.76],
  Eri: [1137.919, 6, 49.51, -28.76],
  For: [397.502, 41, 41.97, -31.63],
  Gem: [513.761, 30, 106.06, 22.6],
  Gru: [365.513, 45, 336.85, -46.35],
  Her: [1225.148, 5, 260.79, 27.5],
  Hor: [248.885, 58, 49.14, -53.34],
  Hya: [1302.844, 1, 174.18, -14.53],
  Hyi: [243.035, 61, 35.16, -69.96],
  Ind: [294.006, 49, 329.58, -59.71],
  Lac: [200.688, 68, 336.92, 46.04],
  Leo: [946.964, 12, 160.01, 13.14],
  Lep: [290.291, 51, 83.49, -19.05],
  Lib: [538.052, 29, 227.99, -15.23],
  LMi: [231.956, 64, 153.68, 32.13],
  Lup: [333.683, 46, 228.3, -42.71],
  Lyn: [545.386, 28, 119.88, 47.47],
  Lyr: [286.476, 52, 282.79, 36.69],
  Men: [153.484, 75, 81.22, -77.5],
  Mic: [209.513, 66, 314.47, -36.27],
  Mon: [481.569, 35, 105.91, 0.28],
  Mus: [138.355, 77, 188.82, -70.16],
  Nor: [165.29, 74, 238.55, -51.35],
  Oct: [291.045, 50, 345.0, -82.15],
  Oph: [948.34, 11, 260.92, -7.91],
  Ori: [594.12, 26, 83.65, 5.95],
  Pav: [377.666, 44, 294.18, -65.78],
  Peg: [1120.794, 7, 340.46, 19.47],
  Per: [614.997, 24, 47.62, 45.01],
  Phe: [469.319, 37, 13.98, -48.58],
  Pic: [246.739, 59, 85.61, -53.47],
  PsA: [245.375, 60, 334.27, -30.64],
  Psc: [889.417, 14, 7.24, 13.69],
  Pup: [673.434, 20, 108.87, -31.18],
  Pyx: [220.833, 65, 134.29, -27.35],
  Ret: [113.936, 82, 58.82, -60.0],
  Scl: [474.764, 36, 6.57, -32.09],
  Sco: [496.783, 33, 253.31, -27.03],
  Sct: [109.114, 84, 280.1, -9.89],
  Ser: [636.928, 23, 236.62, 10.97],
  Sex: [313.515, 47, 154.07, -2.61],
  Sge: [79.932, 86, 294.76, 18.86],
  Sgr: [867.432, 15, 286.49, -28.48],
  Tau: [797.249, 17, 70.53, 14.88],
  Tel: [251.512, 57, 289.88, -51.04],
  TrA: [109.978, 83, 241.24, -65.39],
  Tri: [131.847, 78, 32.77, 31.48],
  Tuc: [294.557, 48, 356.66, -65.83],
  UMa: [1279.66, 3, 169.69, 50.72],
  UMi: [255.864, 56, 225.0, 77.7],
  Vel: [499.649, 32, 143.66, -47.17],
  Vir: [1294.428, 2, 201.1, -4.16],
  Vol: [141.354, 76, 116.93, -69.8],
  Vul: [268.165, 55, 303.47, 24.44],
};

// Who first drew it as a constellation.
const PTOLEMY =
  "One of the 48 constellations in Ptolemy’s Almagest, written around 150 CE, from star pictures far older still.";
const ARGO =
  "Part of Argo Navis, the ship of Jason and the Argonauts, in Ptolemy’s list of 48, until Nicolas-Louis de Lacaille split that huge constellation in three in 1756.";
const DUTCH =
  "One of 12 constellations made from the stars of the far south by the Dutch navigators Pieter Keyser and Frederick de Houtman, on their voyage to the East Indies in 1595–97.";
const PLANCIUS = "Added by the Dutch mapmaker Petrus Plancius around 1600, in a gap between older constellations.";
const HEVELIUS =
  "Made by Johannes Hevelius of Gdańsk from faint stars in a gap between older constellations, in his star atlas of 1690.";
const LACAILLE =
  "Made by Nicolas-Louis de Lacaille in the 1750s, from his observatory at the Cape of Good Hope: one of 14 he named, most of them after the instruments of science and art.";
const ORIGIN = {
  ...Object.fromEntries(
    "And Aqr Aql Ara Ari Aur Boo Cnc CMa CMi Cap Cas Cen Cep Cet CrA CrB Crv Crt Cyg Del Dra Equ Eri Gem Her Hya Leo Lep Lib Lup Lyr Oph Ori Peg Per Psc PsA Sge Sgr Sco Ser Tau Tri UMa UMi Vir"
      .split(" ")
      .map((id) => [id, PTOLEMY])
  ),
  ...Object.fromEntries(["Car", "Pup", "Vel"].map((id) => [id, ARGO])),
  ...Object.fromEntries("Aps Cha Dor Gru Hyi Ind Mus Pav Phe TrA Tuc Vol".split(" ").map((id) => [id, DUTCH])),
  ...Object.fromEntries(["Cam", "Col", "Mon"].map((id) => [id, PLANCIUS])),
  ...Object.fromEntries("CVn Lac LMi Lyn Sct Sex Vul".split(" ").map((id) => [id, HEVELIUS])),
  ...Object.fromEntries(
    "Ant Cae Cir For Hor Men Mic Nor Oct Pic Pyx Ret Scl Tel".split(" ").map((id) => [id, LACAILLE])
  ),
  Cru: "Ptolemy counted its stars as part of the Centaur; European navigators of the 1500s made it a constellation of its own.",
  Com: "An old Greek star group, made a constellation of its own in the 1500s, and in Tycho Brahe’s star catalogue of 1602.",
};

// What it shows, and its story.
const STORY = {
  And: "Princess Andromeda, chained to a rock as an offering to the sea monster Cetus, until Perseus came to save her. In it is the Andromeda Galaxy, 2.5 million light-years away: the furthest thing you can see with your eyes alone.",
  Ant: "An air pump, one of the marvels of science when Lacaille named it.",
  Aps: "A bird of paradise. Its name means “without feet”: the first skins brought to Europe had them cut off.",
  Aqr: "The water bearer, pouring water from a jar: in Greek stories Ganymede, carried off to be cupbearer to the gods. Jupiter’s biggest moon is named after him.",
  Aql: "The eagle that carried Zeus’s thunderbolts. Its bright star Altair makes the Summer Triangle with Vega and Deneb.",
  Ara: "The altar where the gods swore to stand together before their war with the Titans.",
  Ari: "The ram with the golden fleece, which Jason and the Argonauts sailed to find.",
  Aur: "The charioteer, carrying a goat on his shoulder: his bright star Capella means “little she-goat”.",
  Boo: "The herdsman, driving the bears round the pole. His star Arcturus, “guardian of the bear”, is the brightest in the northern sky.",
  Cae: "A sculptor’s chisel: a few faint stars Lacaille named after an engraver’s tool.",
  Cam: "A giraffe (a “camelopard”, a camel-leopard): big, but all faint stars.",
  Cnc: "The crab sent to nip Heracles while he fought the Hydra: he crushed it underfoot. In it is the Beehive, a cluster of stars you can see as a misty patch.",
  CVn: "The hunting dogs of Boötes the herdsman. In it is the Whirlpool Galaxy.",
  CMa: "Orion’s big dog, with Sirius, the brightest star in the night sky, in its jaw.",
  CMi: "Orion’s little dog. Its star Procyon means “before the dog”: it rises just before Sirius.",
  Cap: "The sea-goat, a goat with a fish’s tail: the god Pan, caught half-changed into a fish as he jumped into a river to escape the monster Typhon.",
  Car: "The keel of the Argo, Jason’s ship. Its star Canopus is the second brightest in the night sky.",
  Cas: "Queen Cassiopeia, who boasted she was more beautiful than the sea nymphs. As punishment she circles the pole on her throne, upside down half the time. Her five brightest stars make a W.",
  Cen: "A centaur, half man and half horse. In its foot is Alpha Centauri, the nearest star system to the Sun.",
  Cep: "King Cepheus, Andromeda’s father. His star Delta Cephei gave its name to the Cepheids: stars whose steady pulsing lets astronomers measure the distances to other galaxies.",
  Cet: "The sea monster sent to devour Andromeda. Its star Mira, “the wonderful”, swells and fades over 11 months, from easy to see to far too faint.",
  Cha: "A chameleon, in the faint far-southern sky.",
  Cir: "A drawing compass: with Norma the set square and the Southern Triangle, a whole set of drawing tools.",
  Col: "A dove: the one Noah sent out from the ark, which came back with an olive branch.",
  Com: "Queen Berenice’s hair. She cut it off as an offering for her husband’s safe return from war; when it vanished from the temple, the court astronomer said the gods had put it in the sky. The only constellation named after someone who really lived.",
  CrA: "A southern crown, or wreath: a little arc of stars at the Archer’s feet.",
  CrB: "The crown the god Dionysus gave Ariadne: a neat semicircle of stars.",
  Crv: "Apollo sent the crow to fetch water in a cup, but it dawdled, eating figs, then blamed a water snake. Apollo put all three in the sky: the crow, Crater the cup and Hydra the snake, with the cup forever just out of the crow’s reach.",
  Crt: "The cup Apollo’s crow was sent to fill: see Corvus, beside it.",
  Cru: "The Southern Cross, the smallest constellation. Its long bar points towards the south pole of the sky, and it’s on the flags of Australia, New Zealand, Brazil, Samoa and Papua New Guinea.",
  Cyg: "The swan: Zeus in disguise. Its brightest stars make the Northern Cross, along the Milky Way.",
  Del: "The dolphin that won Amphitrite for Poseidon. Two of its stars, Sualocin and Rotanev, are Nicolaus Venator spelt backwards: an astronomer’s assistant sneaked his own name into a star catalogue in 1814.",
  Dor: "A dolphinfish (mahi-mahi). In it is most of the Large Magellanic Cloud, a small galaxy next to ours.",
  Dra: "The dragon Ladon, who guarded the golden apples. Its star Thuban was the pole star when the pyramids were built.",
  Equ: "A little horse: the second smallest constellation, next to the great winged horse Pegasus.",
  Eri: "The river Eridanus, where Phaethon fell after losing control of the Sun’s chariot. It winds a long way south, to Achernar, “the end of the river”.",
  For: "A chemist’s furnace. In it is the Hubble Ultra Deep Field, where a tiny patch of “empty” sky turned out to hold 10,000 galaxies.",
  Gem: "The twins Castor and Pollux. When mortal Castor died, Pollux shared his own immortality with him, so they’re together in the sky.",
  Gru: "A crane, with its long neck stretched out in flight.",
  Her: "The hero Heracles, kneeling, upside down to us. In it is M13, a great ball of hundreds of thousands of stars, which the Arecibo radio telescope beamed a message to in 1974.",
  Hor: "A pendulum clock, honouring Christiaan Huygens, who invented it.",
  Hya: "The many-headed monster Heracles fought, or the water snake in the story of the crow. It’s the biggest constellation of all, stretching over a quarter of the way round the sky.",
  Hyi: "A little water snake, in the far-southern sky between the two Magellanic Clouds.",
  Ind: "An Indigenous person, as European sailors of the 1590s drew them.",
  Lac: "A lizard, squeezed in between Cygnus and Andromeda.",
  Leo: "The Nemean lion, killed by Heracles in the first of his twelve labours. Its mane is a backwards question mark of stars, the Sickle, where the Leonid meteors seem to come from each November.",
  LMi: "A little lion, above Leo: a few faint stars.",
  Lep: "A hare, crouching at Orion’s feet, chased round the sky by his dogs.",
  Lib: "The scales of justice: the only constellation the Sun passes through that isn’t a living thing. It was once the Scorpion’s claws, and its stars’ names still mean “southern claw” and “northern claw”.",
  Lup: "A wolf, or some wild beast, speared by the Centaur next to it.",
  Lyn: "A lynx. Hevelius said you’d need the eyes of a lynx to see it, it’s so faint.",
  Lyr: "The lyre of Orpheus, whose music could charm stones. Its star Vega will be the pole star in about 12,000 years.",
  Men: "Table Mountain, above Cape Town, where Lacaille watched the sky: the only constellation named after a place on Earth. The Large Magellanic Cloud lies over it, like the cloud that often covers the real mountain.",
  Mic: "A microscope.",
  Mon: "A unicorn, between Orion and his dogs, in the winter Milky Way.",
  Mus: "A fly: the only insect in the sky.",
  Nor: "A carpenter’s set square, or level.",
  Oct: "An octant, a navigator’s instrument for measuring angles. In it is the south pole of the sky, with only a faint star, Sigma Octantis, to mark it.",
  Oph: "The serpent bearer: Asclepius, a healer so skilled he could bring the dead back to life, holding a snake.",
  Ori: "Orion the hunter, with red Betelgeuse at his shoulder, blue-white Rigel at his foot, and the Orion Nebula, where new stars are being born, in his sword. He was killed by the Scorpion, so they were set on opposite sides of the sky, never up together.",
  Pav: "A peacock: Hera’s bird, given the hundred eyes of her watchman Argus on its tail.",
  Peg: "Pegasus, the winged horse that sprang from Medusa when Perseus cut off her head. Its body is the Great Square.",
  Per: "The hero Perseus, holding Medusa’s head. In it is Algol, the “demon star”, which dims every 2 days 21 hours as a dimmer star passes in front of it. The Perseid meteors seem to come from here each August.",
  Phe: "The phoenix, the bird reborn from its own ashes.",
  Pic: "A painter’s easel. In it is Beta Pictoris, a young star with a disc of dust and planets round it.",
  Psc: "Two fish, tied together by a cord: Aphrodite and her son Eros, who changed into fish to escape the monster Typhon. The Sun crosses the celestial equator in Pisces at the March equinox.",
  PsA: "The southern fish, drinking the water poured from Aquarius’s jar. Its star Fomalhaut means “mouth of the fish”.",
  Pup: "The stern of the Argo, Jason’s ship.",
  Pyx: "A ship’s compass, next to the old ship Argo.",
  Ret: "A reticle: the fine crosshairs in Lacaille’s telescope, which he used to measure the stars’ positions.",
  Sge: "An arrow: the third smallest constellation.",
  Sgr: "The archer, a centaur aiming at the Scorpion’s heart: its brightest stars make a teapot. The centre of the Milky Way lies here, with its black hole, 26,000 light-years away.",
  Sco: "The scorpion that killed Orion. Its red heart, Antares, means “rival of Mars”.",
  Scl: "A sculptor’s studio. In it is the south pole of the Milky Way: looking that way, you see out of our galaxy, to others.",
  Sct: "A shield, honouring King Jan III Sobieski of Poland, who led the army that lifted the siege of Vienna in 1683.",
  Ser: "The serpent held by Ophiuchus: the only constellation in two pieces, its head on one side of him and its tail on the other.",
  Sex: "A sextant: the instrument Hevelius measured the stars with, lost when his observatory burned down in 1679.",
  Tau: "The bull: Zeus in disguise, carrying off Princess Europa (Jupiter’s icy moon is named after her). In it are two star clusters, the Pleiades and the Hyades, and red Aldebaran, the bull’s eye.",
  Tel: "A telescope.",
  Tri: "A triangle. In it is the Triangulum Galaxy, the third biggest in our Local Group.",
  TrA: "A southern triangle: one of the set of drawing tools with Norma and Circinus.",
  Tuc: "A toucan. In it are the Small Magellanic Cloud, a galaxy next to ours, and 47 Tucanae, a great ball of stars.",
  UMa: "The Great Bear: Callisto, turned into a bear by jealous Hera, and set in the sky by Zeus (Jupiter’s cratered moon is named after her). Its Plough, or Big Dipper, points to the pole star.",
  UMi: "The Little Bear, often said to be Callisto’s son Arcas. Polaris, the pole star, is at the tip of its tail.",
  Vel: "The sails of the Argo, Jason’s ship. In it is the Vela pulsar, what’s left of a star that exploded about 11,000 years ago, spinning 11 times a second.",
  Vir: "The maiden, goddess of the harvest, holding an ear of wheat: her star Spica. It’s the second biggest constellation, and in it is the Virgo Cluster, over a thousand galaxies.",
  Vol: "A flying fish, leaping from the sea.",
  Vul: "A little fox. The first pulsar was found here, in 1967, by Jocelyn Bell Burnell.",
};

/** Everything known here about one constellation, by IAU abbreviation. */
export function constellationFacts(id) {
  const [area, rank, ra, dec] = AREAS[id];
  return { area, rank, ra, dec, origin: ORIGIN[id], story: STORY[id] };
}

// Horoscopes' dates for their signs (fixed some 2,000 years ago): [first, last], as [month, day].
export const HOROSCOPE = {
  Ari: [
    [3, 21],
    [4, 19],
  ],
  Tau: [
    [4, 20],
    [5, 20],
  ],
  Gem: [
    [5, 21],
    [6, 20],
  ],
  Cnc: [
    [6, 21],
    [7, 22],
  ],
  Leo: [
    [7, 23],
    [8, 22],
  ],
  Vir: [
    [8, 23],
    [9, 22],
  ],
  Lib: [
    [9, 23],
    [10, 22],
  ],
  Sco: [
    [10, 23],
    [11, 21],
  ],
  Sgr: [
    [11, 22],
    [12, 21],
  ],
  Cap: [
    [12, 22],
    [1, 19],
  ],
  Aqr: [
    [1, 20],
    [2, 18],
  ],
  Psc: [
    [2, 19],
    [3, 20],
  ],
};

const DAY = 86400000;
const sunCache = new Map();

/** The Sun's place among the stars at noon UTC on each day of `year`: [{ ms, ra (deg), dec, con }]. */
function sunDays(year) {
  let days = sunCache.get(year);
  if (days) return days;
  days = [];
  for (let ms = Date.UTC(year, 0, 1, 12); ms < Date.UTC(year + 1, 0, 1); ms += DAY) {
    const eq = A.EquatorFromVector(A.GeoVector(A.Body.Sun, new Date(ms), true));
    days.push({ ms, ra: eq.ra * 15, dec: eq.dec, con: A.Constellation(eq.ra, eq.dec).symbol });
  }
  sunCache.set(year, days);
  return days;
}

/**
 * When the Sun is in front of a constellation in `year`: [{ start, end }] (ms, each
 * day it's there at noon UTC), or [] for one it never passes through. A stay across
 * the new year (Sagittarius's) is counted from the December it starts in, running on
 * into the next January.
 */
export function sunInConstellation(id, year) {
  const spans = spansIn(id, year);
  // (Begun the December before: that year's.)
  if (spans[0]?.start === Date.UTC(year, 0, 1, 12) && sunDays(year - 1).at(-1).con === id) spans.shift();
  const last = spans.at(-1);
  if (last?.end === sunDays(year).at(-1).ms) {
    const next = spansIn(id, year + 1)[0];
    if (next?.start === Date.UTC(year + 1, 0, 1, 12)) last.end = next.end;
  }
  return spans;
}

/** The days in `year` the Sun is in front of a constellation, in runs: [{ start, end }]. */
function spansIn(id, year) {
  const spans = [];
  for (const d of sunDays(year)) {
    const last = spans[spans.length - 1];
    if (d.con !== id) continue;
    if (last && d.ms - last.end <= DAY) last.end = d.ms;
    else spans.push({ start: d.ms, end: d.ms });
  }
  return spans;
}

/** The day in `year` (ms) when a constellation is opposite the Sun: highest around midnight. */
export function highestAtMidnight(id, year) {
  const { ra } = constellationFacts(id);
  let best = null;
  for (const d of sunDays(year)) {
    const off = Math.abs(((d.ra - ra - 180 + 540) % 360) - 180);
    if (!best || off < best.off) best = { off, ms: d.ms };
  }
  return best.ms;
}

/**
 * How much of a constellation (its stars' declinations, degrees) you can see from
 * latitude `lat`. A star never sets when it's nearer your pole than your latitude
 * is from the equator, and never rises when it's that near the other pole.
 * { all: "sets" } if none of it ever sets; { all: "rises", seeFrom } if none of it
 * ever rises (seeFrom: the latitude you'd have to go past to see any of it);
 * otherwise { someNeverSet, someNeverRise, seeAllFrom }. `toward`: "south" or
 * "north", the way you'd have to go.
 */
export function fromLatitude(decs, lat) {
  const pole = lat >= 0 ? 1 : -1; // your own pole: north, or south
  const reach = 90 - Math.abs(lat);
  const near = decs.map((d) => d * pole); // how far towards your pole
  const toward = pole > 0 ? "south" : "north";
  // The latitude where something this far towards your pole just rises.
  const latFor = (n) => {
    const l = (90 + n) * pole;
    return `${Math.abs(Math.round(l))}°${l >= 0 ? "N" : "S"}`;
  };
  if (near.every((d) => d > reach)) return { all: "sets" };
  if (near.every((d) => d < -reach)) return { all: "rises", seeFrom: latFor(Math.max(...near)), toward };
  const someNeverRise = near.some((d) => d < -reach);
  return {
    someNeverSet: near.some((d) => d > reach),
    someNeverRise,
    seeAllFrom: someNeverRise ? latFor(Math.min(...near)) : null,
    toward,
  };
}
