# Feature spec: Cheese fallback

## Goal
When I haven't provided a location, put me inside an actual wheel of cheese. Let me leave for the real sky by using my location, choosing a place manually, or explicitly trying a demo without sharing my location.

## Decisions
- Next milestone -> Cheese first; lunar landings and the Jupiter system are follow-up work. (source: user)
- No selected observer location -> Start inside a fictional wheel of cheese, not in a default Earth sky or on a splash screen. This replaces the startup fallback in the Earth Sky spec. (source: user)
- Exit the cheese -> Offer **Use my location**, **Pick a place**, and an explicit, clearly labeled **Try demo sky**. Denied, unavailable, or timed-out geolocation leaves visitors who haven't selected a location inside the cheese. (source: user)
- Privacy -> Only request browser location on explicit action. Do not transmit searches or coordinates or persist the selection between visits. (source: existing code)

## Assumptions
- Use Reykjavík for the opt-in demo, reusing the existing example city. Needs confirmation before release: no.
- Let visitors look around the interior with pointer drag, touch, or keyboard. Keep exit controls accessible with or without WebGL; the fallback must still show a recognizable cheese interior. Walking around and simulated cheese physics are unnecessary. Needs confirmation before release: no.
- The cheese has no observer coordinates, local sky, or solar-event readouts. Enter the real sky at the current instant on the first selection in a visit; after that, location changes preserve simulation time as before. Reloading without selecting a place again returns to the cheese. Needs confirmation before release: no.
- **Pick a place** reuses existing city, coordinate, and globe-pin selection. Merely opening or canceling a picker does not choose a site. A newly selected manual or demo site takes precedence over a pending location request. Needs confirmation before release: no.

## Out of scope
- Lunar landings, Earth phases from the Moon, Jupiter and its moons, and travel to other planets.
- Changes to Earth astronomy, time-zone coverage, star catalogs, or deployment.

## Acceptance criteria
1. A fresh load, even with browser permission already granted, shows the first-person cheese interior and the three exit options. It makes no automatic location request and shows no Earth sky or observer readouts until a location is selected.
2. Pointer drag, touch swipe, and keyboard input change the view inside the wheel. With WebGL 2 disabled, the visitor still sees a recognizable interior and can use all three exit options; the existing globe-pin capability still depends on WebGL 2.
3. From the cheese, a successful explicit location request opens the sky at the returned coordinates. Denial, timeout, or an unavailable API leaves the visitor in the cheese with an explanation and usable manual and demo options. After entering an Earth sky, a failed request leaves the current site intact.
4. Selecting a city, valid coordinates, or a globe pin opens the Earth sky for that site. Canceling or submitting invalid coordinates does not set a site. If an outstanding geolocation callback arrives after manual or demo selection, it does not replace the selection.
5. **Try demo sky** opens a clearly labeled Reykjavík demo without requesting geolocation. With a controlled wall clock, the first location selection starts at the current instant; later location changes preserve the simulation instant. Reloading returns to the cheese without retaining the prior site.

## Impacted areas
- Startup state, location controls and status messages, scene rendering, and browser smoke tests. No backend, migrations, or runtime services.
- README and the Earth Sky startup documentation need to reflect the new fallback when it ships.

## Open risks
- **Low — visual clarity:** The interior needs to read as *inside* a wheel of cheese, including on small screens and without WebGL. Check this visually in addition to testing input and exit behavior.

GATE: spec awaiting approval
