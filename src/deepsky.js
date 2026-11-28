// Deep-sky objects: star clusters, nebulae and galaxies. Their places, brightness
// and sizes are in data/deepsky.json (see tools/convert-deepsky.mjs); here are their
// names, how far away they are, something to know about them, and when you can see
// them.
//
// Seeing a faint smudge isn't like seeing a star. A small one is: it's its total
// light that counts, against the limit the sky's brightness sets (the same limit as
// the stars', see points.js). But a big one spreads its light thin, and then what
// counts is how much brighter its surface is than the sky behind it. The eye pools
// light over a patch about a degree across in the dark (Ricco's area): within it,
// spreading the light makes no difference; beyond it, only the surface brightness
// does. So the Orion Nebula and the Andromeda Galaxy show from a dark site, and
// fade into a city's glow, while the Ring Nebula, as bright in total as many
// galaxies but tiny, needs a telescope.

/** The natural night sky's glow (cd/m²), with no Moon or lights: as glsl.THROUGH_EARTH_SKY. */
export const DARK_SKY = 2.4e-4;
const RICCO = 9.3e6; // square arcseconds: the patch (about a degree across) the dark-adapted eye pools light over
const PEAK = 4.08; // how much brighter an object's middle is than its average (for the profile exp(−4ρ²))

/** The faintest star you can see (magnitude) against sky of luminance L (cd/m²). As points.js. */
export const limitingMag = (L) => 7.93 - 5 * Math.log10(1 + 63 * Math.sqrt(L));

/** Air the light comes through, in multiples of straight up (Kasten–Young). As points.js. */
export function airmass(altDeg) {
  const h = Math.max(altDeg, -1.5);
  return 1 / (Math.sin((h * Math.PI) / 180) + 0.50572 * (h + 6.07995) ** -1.6364);
}

/**
 * How easily you can see an object's brightest part: 1 is only just, 10 easily, below
 * 1 not at all. skyL: the sky's luminance behind it (cd/m²); trans: how much of its
 * light gets through the air; gain: how many magnitudes zooming in gives (see
 * telescopeGain). Binoculars and telescopes gather more light, but they spread an
 * object's image out as they magnify it, so the surface of a big one is no brighter
 * through them: zooming in shows more of a small one, not of a big one.
 */
export function seeing({ mag, major, minor }, skyL, { trans = 1, gain = 0 } = {}) {
  if (mag == null) return 0;
  const flux = 10 ** (-0.4 * mag) * trans;
  const g = 10 ** (0.4 * gain);
  const area = (Math.PI / 4) * major * minor * 3600; // square arcseconds
  return (flux * g * Math.min(1, (PEAK * RICCO) / (area * g))) / 10 ** (-0.4 * limitingMag(skyL));
}

/** The same sums for the shader (see scene/deepsky.js), with these numbers. */
export const SEEING_GLSL = { RICCO, PEAK };

// Ordinary 10×50 binoculars show stars about 3 magnitudes fainter than your eye does.
export const BINOCULARS = 3;

/**
 * What you need to see it, under a dark sky with it high up (above most of the air's
 * dimming): "eye", "binoculars" or "telescope". Null for what isn't a thing to see.
 */
export function howToSee(o) {
  if (o.mag == null) return null;
  const high = { trans: 10 ** (-0.4 * 0.2 * airmass(60)) };
  if (seeing(o, DARK_SKY, high) >= 1.2) return "eye";
  if (seeing(o, DARK_SKY, { ...high, gain: BINOCULARS }) >= 1.5) return "binoculars";
  return "telescope";
}

const TYPES = {
  oc: {
    kind: "Open star cluster",
    about:
      "An open cluster: a family of stars born together from one cloud of gas, slowly drifting apart as they go round the Milky Way.",
    tint: [0.86, 0.92, 1],
  },
  gc: {
    kind: "Globular star cluster",
    about:
      "A globular cluster: hundreds of thousands of very old stars in a ball, among the oldest things in our galaxy, going round its centre far above and below the disc of the Milky Way.",
    tint: [1, 0.95, 0.86],
  },
  sg: {
    kind: "Spiral galaxy",
    about: "A spiral galaxy, like our own: billions of stars, far beyond the Milky Way.",
    tint: [1, 0.94, 0.86],
  },
  eg: {
    kind: "Elliptical galaxy",
    about: "An elliptical galaxy: a great ball of old stars, with little gas left to make new ones.",
    tint: [1, 0.92, 0.84],
  },
  ig: { kind: "Irregular galaxy", about: "", tint: [0.95, 0.95, 1] },
  en: {
    kind: "Nebula",
    about: "A cloud of gas, glowing in the light of the hot young stars being born in it.",
    tint: [0.84, 1, 0.92],
  },
  rn: {
    kind: "Reflection nebula",
    about: "A cloud of dust, lit by the light of stars near it.",
    tint: [0.82, 0.9, 1],
  },
  pn: {
    kind: "Planetary nebula",
    about:
      "A planetary nebula: the shell a dying star like the Sun puffs off at the end of its life, lit by the hot core left behind. (Through early telescopes they looked like the discs of planets, hence the name.)",
    tint: [0.8, 1, 0.96],
  },
  sn: { kind: "Supernova remnant", about: "", tint: [0.9, 0.95, 1] },
  as: { kind: "Star cloud", about: "", tint: [1, 1, 1] },
  dn: { kind: "Dark nebula", about: "", tint: [1, 1, 1] },
  pl: { kind: "Centre of the Milky Way", about: "", tint: [1, 1, 1] },
};
export const deepSkyTint = (type) => TYPES[type]?.tint ?? [1, 1, 1];

// By id: its name, how far away it is (light-years), its tilt on the sky (position
// angle of its long axis, degrees from north through east), and something to know.
// Distances are the usual modern estimates: for galaxies, good to 10% or so.
const FACTS = {
  M1: {
    name: "Crab Nebula",
    ly: 6500,
    note: "What’s left of a star that blew up: Chinese astronomers saw the supernova in 1054, bright enough to see by day for three weeks. At its heart a neutron star, the city-sized core of the old star, spins 30 times a second. Charles Messier began his list with it in 1758, after mistaking it for a comet.",
  },
  M2: { ly: 37500 },
  M3: {
    ly: 33900,
    note: "One of the biggest globular clusters, with half a million stars, and more stars that vary in brightness than any other.",
  },
  M4: { ly: 7200, note: "One of the nearest globular clusters to us, beside Antares." },
  M5: { ly: 24500, note: "One of the oldest globular clusters, about 13 billion years old." },
  M6: { name: "Butterfly Cluster", ly: 1600, note: "Its brightest stars look like a butterfly’s open wings." },
  M7: {
    name: "Ptolemy’s Cluster",
    ly: 980,
    note: "Ptolemy wrote of it nearly 2,000 years ago, as “a nebula following the sting of Scorpius”: one of the first deep-sky objects anyone wrote down.",
  },
  M8: {
    name: "Lagoon Nebula",
    ly: 4100,
    pa: 90,
    note: "A cloud of glowing gas where stars are being born, cut across by a dark lane of dust: the lagoon. From a dark site it’s a hazy patch just above the spout of the Teapot in Sagittarius, one of the few nebulae you can see by eye.",
  },
  M9: { ly: 25800 },
  M10: { ly: 14300 },
  M11: {
    name: "Wild Duck Cluster",
    ly: 6200,
    note: "One of the richest open clusters, nearly 3,000 stars. Its brightest make a V, like a flight of wild ducks.",
  },
  M12: { ly: 16000 },
  M13: {
    name: "Hercules Cluster",
    ly: 22200,
    note: "Several hundred thousand stars in a ball 145 light-years across. In 1974 the Arecibo radio telescope beamed a message towards it, which will get there in about 22,000 years.",
  },
  M14: { ly: 30300 },
  M15: {
    ly: 33600,
    note: "One of the most tightly packed globular clusters: its core seems to have collapsed in on itself. It holds the first planetary nebula found in a globular cluster.",
  },
  M16: {
    name: "Eagle Nebula",
    ly: 7000,
    note: "A cluster of young stars lighting up the cloud they were born in, home of the Pillars of Creation that the Hubble Space Telescope photographed in 1995: towers of gas and dust where new stars are forming.",
  },
  M17: {
    name: "Omega Nebula",
    ly: 5000,
    pa: 120,
    note: "Also called the Swan Nebula: one of the brightest clouds of star-forming gas in the sky, after the Orion Nebula.",
  },
  M18: { ly: 4900 },
  M19: { ly: 28700 },
  M20: {
    name: "Trifid Nebula",
    ly: 5200,
    note: "Split into three by dark lanes of dust: glowing red gas round a hot young star, beside a blue cloud of dust lit by starlight.",
  },
  M21: { ly: 4250 },
  M22: {
    name: "Sagittarius Cluster",
    ly: 10400,
    note: "One of the nearest and brightest globular clusters. Abraham Ihle came across it in 1665: the first globular cluster anyone found.",
  },
  M23: { ly: 2150 },
  M24: {
    name: "Sagittarius Star Cloud",
    ly: 10000,
    pa: 30,
    note: "Not a cluster but a window: a gap in the dust that lets us see deep into the Milky Way, to a cloud of countless stars.",
  },
  M25: { ly: 2000 },
  M26: { ly: 5000 },
  M27: {
    name: "Dumbbell Nebula",
    ly: 1360,
    pa: 125,
    note: "The first planetary nebula ever found, by Messier in 1764: the outer layers of a dying star, puffed off into space. In about 10,000 years it will have faded away.",
  },
  M28: { ly: 17900 },
  M29: { ly: 4000 },
  M30: { ly: 26100 },
  M31: {
    name: "Andromeda Galaxy",
    ly: 2500000,
    pa: 35,
    note: "The nearest big galaxy to ours, and the farthest thing you can easily see with just your eyes: a trillion stars in a spiral like the Milky Way’s, but bigger. In 1923 Edwin Hubble found stars in it that showed how far away it is, far beyond the Milky Way: until then, many thought it was a cloud in our own galaxy. It’s coming towards us at 110 km a second, and in some billions of years the two may merge into one.",
  },
  M32: {
    ly: 2650000,
    pa: 170,
    note: "A small galaxy going round the Andromeda Galaxy, as the Magellanic Clouds go round ours.",
  },
  M33: {
    name: "Triangulum Galaxy",
    ly: 2730000,
    pa: 23,
    note: "The third biggest galaxy in our Local Group, after the Andromeda Galaxy and the Milky Way. Its light is spread so thin that you can only see it by eye from a really dark site, and best by looking a little to one side of it.",
  },
  M34: { ly: 1500 },
  M35: { ly: 2800, note: "A cluster of a few hundred stars at the feet of Castor, in Gemini." },
  M36: { ly: 4100 },
  M37: { ly: 4500 },
  M38: { ly: 4200 },
  M39: { ly: 1000 },
  M40: {
    name: "Winnecke 4",
    kind: "Double star",
    ly: 510,
    note: "Two stars that only look close together. Messier was looking for a nebula someone had reported here, and found just this pair.",
  },
  M41: { ly: 2300, note: "Aristotle may have seen it, around 325 BCE, as a cloudy spot below Sirius." },
  M42: {
    name: "Orion Nebula",
    ly: 1340,
    note: "The nearest big nursery of stars to us: a cloud of gas lit up by the young stars born in it, the four of the Trapezium at its heart. You can see it by eye as the fuzzy middle “star” of Orion’s sword. Through binoculars or a telescope it fills with wisps of glowing gas.",
  },
  M43: {
    name: "De Mairan’s Nebula",
    ly: 1600,
    note: "Part of the Orion Nebula, cut off from the rest by a lane of dark dust, and lit by a star of its own.",
  },
  M44: {
    name: "Beehive Cluster",
    ly: 577,
    note: "A swarm of a thousand or so stars, a misty patch to the eye. Galileo counted forty stars in it with his first telescope, in 1610. The ancient Greeks called it Praesepe, the manger, with two stars beside it, the Asses, eating from it.",
  },
  M45: {
    name: "Pleiades",
    ly: 444,
    note: "The Seven Sisters: a cluster of hot young blue stars, only about 100 million years old, in a faint haze of dust. Most people can see six of them, and sharp eyes on a dark night more. Stories all over the world tell of them, as sisters, or girls, or hens and chicks; in Japan they’re Subaru.",
  },
  M46: { ly: 5400 },
  M47: { ly: 1600 },
  M48: { ly: 1500 },
  M49: {
    ly: 56000000,
    note: "The brightest galaxy in the Virgo Cluster, a great swarm of more than a thousand galaxies.",
  },
  M50: { ly: 3000 },
  M51: {
    name: "Whirlpool Galaxy",
    ly: 23000000,
    pa: 163,
    note: "The first galaxy whose spiral arms anyone saw: Lord Rosse drew them in 1845, through the biggest telescope of his day. It’s pulling at a smaller galaxy beside it.",
  },
  M52: { ly: 5000 },
  M53: { ly: 58000 },
  M54: {
    ly: 87400,
    note: "It belongs to another galaxy: the Sagittarius Dwarf, which the Milky Way is slowly tearing apart.",
  },
  M55: { ly: 17600 },
  M56: { ly: 32900 },
  M57: {
    name: "Ring Nebula",
    ly: 2300,
    note: "A dying star’s cast-off shell, which we see end-on, as a smoke ring. The tiny white dwarf in the middle is all that’s left of the star.",
  },
  M58: { ly: 62000000 },
  M59: { ly: 60000000 },
  M60: { ly: 55000000 },
  M61: { ly: 52500000 },
  M62: { ly: 22500 },
  M63: { name: "Sunflower Galaxy", ly: 29000000, pa: 105 },
  M64: {
    name: "Black Eye Galaxy",
    ly: 17000000,
    pa: 115,
    note: "A dark band of dust in front of its bright middle looks like a black eye. Its inner part turns the opposite way to its outer part, maybe from swallowing another galaxy.",
  },
  M65: { ly: 35000000, pa: 174 },
  M66: { ly: 36000000, pa: 173 },
  M67: {
    ly: 2700,
    note: "One of the oldest open clusters, about 4 billion years old: nearly as old as the Sun.",
  },
  M68: { ly: 33600 },
  M69: { ly: 29700 },
  M70: { ly: 29400 },
  M71: { ly: 13000 },
  M72: { ly: 55400 },
  M73: {
    kind: "Asterism",
    ly: 2500,
    note: "Just four stars that happen to line up: not a real cluster at all.",
  },
  M74: { ly: 32000000 },
  M75: { ly: 67500 },
  M76: {
    name: "Little Dumbbell Nebula",
    ly: 2500,
    pa: 40,
    note: "One of the faintest things in Messier’s list.",
  },
  M77: {
    ly: 47000000,
    note: "Its middle shines bright from a black hole swallowing gas: one of the first “active” galaxies found.",
  },
  M78: {
    ly: 1600,
    note: "The brightest reflection nebula: a cloud of dust lit by young stars near it, rather than glowing itself.",
  },
  M79: { ly: 41000 },
  M80: { ly: 32600 },
  M81: {
    name: "Bode’s Galaxy",
    ly: 12000000,
    pa: 157,
    note: "A beautiful spiral, found by Johann Bode in 1774. It and the Cigar Galaxy, beside it, passed close to each other a few hundred million years ago, which set the Cigar Galaxy making new stars.",
  },
  M82: {
    name: "Cigar Galaxy",
    ly: 12000000,
    pa: 65,
    note: "A galaxy we see edge-on, bursting with new stars: stirred up by a close pass by Bode’s Galaxy, it makes stars ten times as fast as the Milky Way.",
  },
  M83: {
    name: "Southern Pinwheel Galaxy",
    ly: 15000000,
    note: "A bright spiral we see face-on. Six supernovae have been seen in it in the last hundred years.",
  },
  M84: { ly: 60000000 },
  M85: { ly: 60000000 },
  M86: { ly: 52000000 },
  M87: {
    name: "Virgo A",
    ly: 53500000,
    note: "A giant galaxy at the heart of the Virgo Cluster of galaxies. In 2019 the black hole at its centre, 6½ billion times as heavy as the Sun, became the first black hole ever photographed.",
  },
  M88: { ly: 47000000, pa: 140 },
  M89: { ly: 50000000 },
  M90: { ly: 58700000, pa: 23 },
  M91: { ly: 63000000 },
  M92: {
    ly: 26700,
    note: "Outshone by the Hercules Cluster nearby, but almost as fine, and one of the oldest things in the Milky Way.",
  },
  M93: { ly: 3600 },
  M94: { ly: 16000000 },
  M95: { ly: 33000000 },
  M96: { ly: 31000000 },
  M97: {
    name: "Owl Nebula",
    ly: 2030,
    note: "A dying star’s shell, with two dark patches in it like an owl’s eyes.",
  },
  M98: { ly: 44400000, pa: 155 },
  M99: { ly: 50000000 },
  M100: { ly: 55000000 },
  M101: {
    name: "Pinwheel Galaxy",
    ly: 21000000,
    note: "A big spiral we see face-on, nearly twice as wide as the Milky Way. Stars blew up in it in 2011 and in 2023, as supernovae bright enough to see with a small telescope.",
  },
  M102: {
    name: "Spindle Galaxy",
    ly: 50000000,
    pa: 128,
    note: "No one is quite sure which galaxy Messier meant by M102: most think it was this one, which we see edge-on.",
  },
  M103: { ly: 10000 },
  M104: {
    name: "Sombrero Galaxy",
    ly: 31000000,
    pa: 90,
    note: "A galaxy we see almost edge-on, with a dark lane of dust across its bright middle, like the brim of a hat.",
  },
  M105: { ly: 32000000 },
  M106: {
    ly: 24000000,
    pa: 150,
    note: "An odd spiral, with two extra arms of gas heated by jets from the black hole at its centre.",
  },
  M107: { ly: 20900 },
  M108: { ly: 46000000, pa: 79 },
  M109: { ly: 83500000 },
  M110: {
    ly: 2690000,
    pa: 170,
    note: "A small galaxy going round the Andromeda Galaxy, as the Magellanic Clouds go round ours.",
  },
  NGC869: {
    name: "Double Cluster",
    ly: 7500,
    pa: 90,
    note: "Two clusters side by side, h and χ Persei, each of a few thousand stars: two misty patches in the Milky Way between Perseus and Cassiopeia. They’re young, only about 13 million years old.",
  },
  Mel25: {
    name: "Hyades",
    ly: 153,
    note: "The nearest star cluster to us: a V of stars making the face of Taurus, the bull. Bright orange Aldebaran looks part of it, but it’s less than half as far away, in front.",
  },
  Mel20: { name: "Alpha Persei Cluster", ly: 570, note: "A loose group of bright blue-white stars round Mirfak." },
  Mel111: {
    name: "Coma Star Cluster",
    ly: 280,
    note: "A sprinkling of faint stars that gave Coma Berenices its name: Queen Berenice’s hair.",
  },
  Cr399: {
    name: "Coathanger",
    kind: "Asterism",
    ly: 420,
    note: "Ten stars in the shape of a coat hanger, upside down. Most aren’t really a cluster, just stars at different distances that happen to line up.",
  },
  Cr140: { ly: 1300 },
  IC2602: {
    name: "Southern Pleiades",
    ly: 480,
    note: "Like the Pleiades: a cluster of young blue stars, the brightest of them θ Carinae.",
  },
  IC2391: {
    name: "Omicron Velorum Cluster",
    ly: 500,
    note: "A cluster of bright stars round ο Velorum, so near that you can see it by eye: the Persian astronomer al-Sufi wrote of it around 964.",
  },
  IC4665: { ly: 1150 },
  NGC104: {
    name: "47 Tucanae",
    ly: 15000,
    note: "The second brightest globular cluster, after Omega Centauri. In the sky it’s beside the Small Magellanic Cloud, but it’s far nearer, in our own galaxy.",
  },
  NGC5139: {
    name: "Omega Centauri",
    ly: 17000,
    note: "The biggest and brightest globular cluster in the Milky Way: ten million stars. Ptolemy listed it as a star; it was 1677 before Edmond Halley saw it was something else. It may be the heart of a small galaxy the Milky Way swallowed long ago, and in 2024 a middle-sized black hole was found at its centre.",
  },
  NGC3372: {
    name: "Carina Nebula",
    ly: 7500,
    note: "A huge cloud of glowing gas, four times as big as the Orion Nebula. In it is Eta Carinae, one of the heaviest stars known, which flared up in 1843 to be the second brightest star in the sky, and may one day blow up as a supernova.",
  },
  NGC3532: {
    name: "Wishing Well Cluster",
    ly: 1600,
    note: "A rich cluster that looks like coins glinting at the bottom of a well. It was the first thing the Hubble Space Telescope looked at, in 1990.",
  },
  NGC2516: { name: "Southern Beehive", ly: 1300 },
  NGC6231: { ly: 5200, note: "A bright cluster of young, very hot stars by the tail of Scorpius." },
  NGC2451: { ly: 600, note: "Two clusters that happen to lie in the same direction, one behind the other." },
  NGC2362: {
    ly: 4800,
    note: "A tiny cluster round the bright star τ Canis Majoris, only about 5 million years old.",
  },
  NGC2244: {
    name: "Rosette Cluster",
    ly: 5200,
    note: "Young stars in the middle of the Rosette Nebula, the flower of gas they were born from.",
  },
  NGC2264: {
    name: "Christmas Tree Cluster",
    ly: 2400,
    note: "A cluster shaped like an upside-down Christmas tree, with the dark Cone Nebula at its tip.",
  },
  NGC4755: {
    name: "Jewel Box",
    ly: 6400,
    note: "A sparkling cluster beside the Southern Cross, with one red star among its blue-white ones: John Herschel thought it looked like a casket of jewels.",
  },
  NGC5128: {
    name: "Centaurus A",
    ly: 12000000,
    pa: 35,
    note: "A galaxy with a dark band of dust across its middle, probably from swallowing a smaller spiral galaxy. The black hole at its centre shoots out jets that glow in radio waves, far out into space.",
  },
  NGC253: {
    name: "Sculptor Galaxy",
    ly: 11400000,
    pa: 52,
    note: "A bright, dusty spiral we see nearly edge-on, making new stars fast. Caroline Herschel found it in 1783.",
  },
  NGC2070: {
    name: "Tarantula Nebula",
    ly: 160000,
    note: "The biggest, brightest star-forming cloud in our neighbourhood of galaxies, in the Large Magellanic Cloud: if it were as near as the Orion Nebula, it would cast shadows.",
  },
  NGC7000: {
    name: "North America Nebula",
    ly: 2200,
    note: "A cloud of glowing gas shaped like North America, with a Gulf of Mexico of dark dust. From a dark site it’s a brighter patch in the Milky Way, beside Deneb.",
  },
  NGC7293: {
    name: "Helix Nebula",
    ly: 650,
    note: "One of the nearest planetary nebulae: a dying star’s shell, half as wide as the full Moon, but so faint it needs a dark sky and binoculars.",
  },
  NGC457: {
    name: "Owl Cluster",
    ly: 7900,
    note: "Its two bright stars look like eyes: some see an owl, others ET.",
  },
  NGC6397: { ly: 7800, note: "One of the two nearest globular clusters to us." },
  NGC6752: { ly: 13000 },
  NGC752: { ly: 1460 },
  LMC: {
    name: "Large Magellanic Cloud",
    kind: "Small galaxy",
    ly: 160000,
    note: "A small galaxy going round ours: to the eye, a cloud twenty Moons wide. Magellan’s crew wrote of it on their voyage round the world in 1519–22, but people in the south had always known it. A supernova in it in 1987 was the nearest seen since the telescope was invented.",
  },
  SMC: {
    name: "Small Magellanic Cloud",
    kind: "Small galaxy",
    ly: 200000,
    note: "The smaller of the Magellanic Clouds, another small galaxy going round ours. In 1912 Henrietta Leavitt found, from stars in it, how to tell how far away galaxies are.",
  },
  GC: {
    name: "Centre of the Milky Way",
    kind: "Black hole",
    ly: 26700,
    note: "The centre of our galaxy, hidden from our eyes by thick clouds of dust. There sits Sagittarius A*, a black hole four million times as heavy as the Sun, first photographed in 2022.",
  },
  Coalsack: {
    name: "Coalsack",
    ly: 600,
    note: "A dark cloud of dust beside the Southern Cross, blotting out the Milky Way behind it. In Aboriginal Australian astronomy it’s the head of the Emu in the Sky, whose body is the dark lanes of the Milky Way.",
  },
};

/** Every object with facts of its own, for the tests. */
export const FACT_IDS = Object.keys(FACTS);

/** "NGC 869" for NGC869, "Collinder 140" for Cr140: a catalogue number, the way it's written. */
const catalogueName = (id) => id.replace(/^(NGC|IC)(\d)/, "$1 $2").replace(/^Cr(\d)/, "Collinder $1");

/**
 * The objects, from data/deepsky.json's rows. conOf(ra, dec) gives the constellation
 * ({ id, name }) it's in.
 */
export function buildDeepSky(rows, conOf) {
  return rows.map(([id, desig, ra, dec, type, mag, glow, major, minor]) => {
    const f = FACTS[id] ?? {};
    const t = TYPES[type];
    const name = f.name ?? catalogueName(id);
    return {
      id,
      ra,
      dec,
      type,
      mag,
      glow, // magnitude of the glow to draw (null: none; the Milky Way's map has it)
      major, // arcminutes
      minor,
      pa: f.pa ?? 0,
      name,
      // Its catalogue numbers, besides its name: "M31", "NGC 224".
      numbers: [/^M\d/.test(id) ? id : "", desig.replace(/^Cr /, "Collinder ")].filter((n) => n && n !== name),
      kind: f.kind ?? t.kind,
      // Something to know about it, or else about its kind.
      about: [f.note ?? t.about].filter(Boolean),
      ly: f.ly ?? null,
      con: conOf(ra, dec),
    };
  });
}

// ---------------------------------------------------------------- Deep time

// Things that happened long ago, to set the oldest light against: [years ago, what happened].
const DEEP_PAST = [
  [20000, "the last ice age was at its coldest"],
  [45000, "people painted the oldest cave paintings we know of"],
  [300000, "our own species first appeared"],
  [3300000, "our ancestors made the oldest stone tools ever found"],
  [6500000, "our ancestors parted from the chimpanzees’"],
  [66000000, "an asteroid wiped out the dinosaurs"],
];

const roundYears = (y) => {
  const r = Number(y.toPrecision(2));
  return r >= 1e6 ? `${Number((r / 1e6).toPrecision(2))} million` : r.toLocaleString("en-GB");
};

/** "The light you’re seeing set off about 2.5 million years ago, after …": for light that left `ago` years back. */
export function deepTimeNote(ago) {
  const [y, what] = DEEP_PAST.reduce((a, b) =>
    Math.abs(Math.log(b[0] / ago)) < Math.abs(Math.log(a[0] / ago)) ? b : a
  );
  const when = Math.abs(Math.log(y / ago)) < 0.1 ? "around when" : ago > y ? "before" : "after";
  return `The light you’re seeing set off about ${roundYears(ago)} years ago, ${when} ${what}.`;
}
