// More about the stars: what their names mean and a fact or two about the famous
// ones, and some things worked out from their light: how hot they are, how bright
// they really are, and how near the pole of the sky comes to them, as it slowly
// circles round every 26,000 years.

const D2R = Math.PI / 180;

// By proper name: what the name means (or `name`, a sentence about the name), and
// something to know about it.
const FACTS = {
  Sirius: {
    meaning: "“the scorching one”, in Greek",
    fact: "The brightest star in the night sky, because it’s near: 8.6 light-years. It has a tiny white-dwarf companion, “the Pup”, first seen in 1862. In ancient Egypt its first rise before dawn each summer told that the Nile would soon flood.",
  },
  Canopus: {
    name: "Canopus is named after the helmsman of King Menelaus’s fleet, in Greek stories.",
    fact: "The second brightest star in the night sky. Spacecraft often steer by it: it’s bright, and far from the Sun in the sky.",
  },
  Arcturus: {
    meaning: "“guardian of the bear”, in Greek",
    fact: "An orange giant racing past us: it has moved more than two Moon-widths across the sky since the ancient Greeks mapped it. In 1933 its light was used to switch on the Chicago World’s Fair: light thought to have set off at the time of the city’s last fair, in 1893.",
  },
  "Rigil Kentaurus": {
    meaning: "“the foot of the centaur”, in Arabic",
    fact: "With Toliman, the nearest stars to the Sun you can see, 4.4 light-years away. A third, tiny star, Proxima Centauri, is nearer still, and has a planet.",
  },
  Toliman: {
    meaning: "“the ostriches”, from an old Arabic name for these stars",
    fact: "Rigil Kentaurus’s companion: the two go round each other every 80 years.",
  },
  Vega: {
    meaning: "“the swooping eagle”, from Arabic",
    fact: "The first star ever photographed, in 1850. For a long time it was the standard star brightnesses were measured against: magnitude zero.",
  },
  Capella: {
    meaning: "“the little she-goat”, in Latin",
    fact: "Two yellow giant stars, going round each other every 104 days: too close together to see apart in any ordinary telescope.",
  },
  Rigel: {
    meaning: "“the foot”, from the Arabic for the foot of the giant",
    fact: "A blue supergiant, Orion’s foot: one of the most powerful stars you can see.",
  },
  Procyon: {
    meaning: "“before the dog”, in Greek: it rises just before Sirius",
    fact: "Like Sirius, it has a tiny white-dwarf companion.",
  },
  Achernar: {
    meaning: "“the end of the river”, in Arabic",
    fact: "It spins so fast that it’s squashed flat: about half as wide again round its middle as from pole to pole.",
  },
  Betelgeuse: {
    meaning: "“the hand of al-Jawzā’”, from Arabic: the giant figure that was later Orion",
    fact: "A red supergiant: put in the Sun’s place, it would swallow the orbit of Mars. It will end as a supernova, maybe within the next 100,000 years. In 2019–20 it dimmed strangely, hidden by a cloud of dust it had puffed out.",
  },
  Hadar: {
    name: "Its name comes from Arabic, but no one is sure what it meant.",
    fact: "With Rigil Kentaurus, one of the two Pointers: follow them to find the Southern Cross.",
  },
  Altair: {
    meaning: "“the flying one”, from the Arabic for the flying eagle",
    fact: "It spins once every 9 hours, so fast it bulges at its middle. In 2007 it became the first star like the Sun (other than the Sun) whose surface was pictured.",
  },
  Acrux: {
    name: "Its name is a modern one, made from its catalogue name, Alpha Crucis.",
    fact: "The foot of the Southern Cross. A small telescope splits it in two.",
  },
  Aldebaran: {
    meaning: "“the follower”, in Arabic: it follows the Pleiades across the sky",
    fact: "The red eye of the bull. The spacecraft Pioneer 10 is heading its way, and will pass it in about two million years.",
  },
  Spica: {
    meaning: "“the ear of wheat”, in Latin, held by the maiden Virgo",
    fact: "Around 130 BCE Hipparchus found that Spica’s position had shifted since older records were made, and so discovered precession: the slow wobble of the Earth’s axis.",
  },
  Antares: {
    meaning: "“the rival of Mars”, in Greek: it’s as red",
    fact: "A red supergiant, the Scorpion’s heart: about 700 times as wide as the Sun.",
  },
  Pollux: {
    name: "Pollux is named after the immortal twin of Greek stories.",
    fact: "The nearest giant star to the Sun, and it has a planet, found in 2006.",
  },
  Castor: {
    name: "Castor is named after the mortal twin of Greek stories.",
    fact: "Six stars in one: three pairs, all going round each other.",
  },
  Fomalhaut: {
    meaning: "“the mouth of the fish”, in Arabic",
    fact: "It’s ringed by a wide disc of dust, where planets may be forming.",
  },
  Deneb: {
    meaning: "“the tail”, in Arabic: the tail of the swan",
    fact: "One of the most powerful stars you can see with your eyes alone: it looks about as bright as Altair while being about a hundred times further away.",
  },
  Regulus: {
    meaning: "“the little king”, in Latin",
    fact: "It sits almost exactly on the Sun’s path, so the Moon often passes in front of it, and it spins so fast it bulges.",
  },
  Bellatrix: {
    meaning: "“the female warrior”, in Latin",
    fact: "Orion’s other shoulder, opposite Betelgeuse: a hot blue giant.",
  },
  Alnilam: {
    meaning: "“the string of pearls”, in Arabic",
    fact: "The middle star of Orion’s Belt, and the furthest of the three, a blue supergiant.",
  },
  Alnitak: {
    meaning: "“the belt”, in Arabic",
    fact: "The eastern star of Orion’s Belt. Just south of it is the Horsehead Nebula, a dark cloud of dust.",
  },
  Saiph: {
    meaning: "“the sword”, in Arabic, though it marks Orion’s knee",
    fact: "Orion’s other knee, opposite Rigel.",
  },
  Shaula: {
    meaning: "“the raised tail”, in Arabic: the Scorpion’s sting",
    fact: "The sting at the tip of the Scorpion’s tail.",
  },
  Dubhe: {
    meaning: "“the bear”, in Arabic",
    fact: "With Merak, one of the Pointers of the Plough: follow them to Polaris.",
  },
  Alkaid: {
    meaning: "“the leader”, in Arabic: in Arabic stories the Plough is a funeral bier, and its handle the mourners",
    fact: "The end of the Plough’s handle.",
  },
  Mizar: {
    meaning: "“the waistband”, in Arabic",
    fact: "Around 1617 it became the first double star seen in a telescope, and in 1857 the first one photographed. Next to it is Alcor: being able to tell the two apart was once a test of good eyesight.",
  },
  Alcor: {
    meaning: "“the faint one”, from Arabic",
    fact: "Mizar’s faint companion in the Plough’s handle: telling the two apart by eye was once a test of eyesight.",
  },
  Polaris: {
    meaning: "“of the pole”, in Latin",
    fact: "Not the brightest star (it’s 48th), but the most useful: it’s three stars in one, and the brightest of them slowly swells and shrinks, every 4 days.",
  },
  Kochab: {
    meaning: "“the star”, in Arabic",
    fact: "With its neighbour Pherkad, one of the two Guardians of the Pole, at the end of the Little Bear.",
  },
  Thuban: {
    meaning: "“the snake”, in Arabic: the dragon Draco",
    fact: "Though it’s labelled Alpha, the first of Draco, it’s only the eighth brightest star in it. It was the pole star when the pyramids of Egypt were built.",
  },
  Algol: {
    meaning: "“the demon’s head”, in Arabic: the head of Medusa that Perseus holds",
    fact: "Every 2 days and 21 hours it fades to a third of its brightness for about 10 hours, as a dimmer star passes in front of it.",
  },
  Mirfak: {
    meaning: "“the elbow”, in Arabic",
    fact: "The brightest of a loose cluster of stars travelling through space together, the Alpha Persei Cluster: lovely in binoculars.",
  },
  Hamal: {
    meaning: "“the lamb”, in Arabic",
    fact: "Two thousand years ago the Sun was in front of Aries at the March equinox: that point in the sky is still called “the first point of Aries”, though precession has moved it into Pisces.",
  },
  Alpheratz: {
    meaning: "“the horse’s navel”, in Arabic",
    fact: "A corner of the Great Square of Pegasus, though it now belongs to Andromeda: for a long time it was counted in both.",
  },
  Denebola: {
    meaning: "“the lion’s tail”, in Arabic",
    fact: "The tip of Leo’s tail.",
  },
  Albireo: {
    name: "Its name came from a muddled translation, through Latin, of the Greek name for the swan.",
    fact: "In even a small telescope, two stars: one gold, one blue. One of the loveliest sights in the sky.",
  },
  Alphard: {
    meaning: "“the solitary one”, in Arabic",
    fact: "The only bright star in its part of the sky, in the long, faint Hydra.",
  },
  Rasalhague: {
    meaning: "“the head of the serpent charmer”, in Arabic",
    fact: "The head of Ophiuchus, holding the serpent.",
  },
  Elnath: {
    meaning: "“the butting one”, in Arabic: the tip of the bull’s horn",
    fact: "The tip of the bull’s horn, once shared with Auriga the charioteer.",
  },
  Diphda: {
    meaning: "“the frog”, in Arabic",
    fact: "The brightest star in Cetus, the sea monster.",
  },
  Gacrux: {
    name: "Its name is a modern one, made from its catalogue name, Gamma Crucis.",
    fact: "The orange-red star at the top of the Southern Cross: the nearest red giant to the Sun.",
  },
};

/** What's known here about a star with this proper name: { meaning or name, fact }, or null. */
export const starFacts = (name) => FACTS[name] ?? null;

/**
 * How hot a star's surface is, from its colour (B−V): °C, and a word for its
 * colour. (Dust between us and it reddens it, so a few look cooler than they are.)
 */
export function starTemperature(bv) {
  const kelvin = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  const colour =
    kelvin < 3900
      ? "red"
      : kelvin < 5200
        ? "orange"
        : kelvin < 6000
          ? "yellow"
          : kelvin < 7500
            ? "yellowish white"
            : kelvin < 10000
              ? "white"
              : "blue-white";
  return { celsius: kelvin - 273, colour };
}

/** How much light a star gives out, as a multiple of the Sun's: from how bright it looks, and how far away it is. */
export function starLuminosity(mag, lightYears) {
  const parsecs = lightYears / 3.2616;
  const absolute = mag - 5 * Math.log10(parsecs / 10);
  return 10 ** (0.4 * (4.83 - absolute));
}

// The Earth's axis slowly circles (precesses) round the pole of the ecliptic, once
// every 25,800 years, so the poles of the sky trace big circles among the stars.
const ECLIPTIC_POLE = unit(270, 66.5607);
const PRECESSION = (50.29 / 3600) * D2R; // a year

function unit(ra, dec) {
  return [Math.cos(dec * D2R) * Math.cos(ra * D2R), Math.cos(dec * D2R) * Math.sin(ra * D2R), Math.sin(dec * D2R)];
}

/** The north pole of the sky in `year`, J2000 equator: J2000's pole, turned round the ecliptic's. */
function northPole(year) {
  const [kx, ky, kz] = ECLIPTIC_POLE;
  const a = -PRECESSION * (year - 2000);
  const c = Math.cos(a);
  const s = Math.sin(a);
  // Rodrigues' rotation of (0, 0, 1) about the ecliptic pole.
  return [ky * s + kx * kz * (1 - c), -kx * s + ky * kz * (1 - c), c + kz * kz * (1 - c)];
}

const angle = (a, b) => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / D2R;

/**
 * How near the poles of the sky come to a star (J2000 `ra`, `dec`, degrees; its own
 * slow drift across the sky left out): { now: { pole, deg }, nearest: { pole, deg,
 * year } } for the pole nearest it in `year`, and the closest either pole comes to
 * it in the 26,000 years round `year` (each pole circles once in that time).
 */
export function poleNearness(ra, dec, year) {
  const star = unit(ra, dec);
  const near = (y) => {
    const n = northPole(y);
    const north = angle(n, star);
    return north <= 90 ? { pole: "north", deg: north } : { pole: "south", deg: 180 - north };
  };
  let nearest = null;
  for (let y = Math.round(year) - 12900; y <= year + 12900; y += 10) {
    const p = near(y);
    if (!nearest || p.deg < nearest.deg) nearest = { ...p, year: y };
  }
  return { now: near(year), nearest };
}
