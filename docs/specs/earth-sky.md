# Feature spec: Earth sky planetarium

## Goal
Start with the sky over my location right now. Let me move around Earth, scrub through a day or year, and see how the Sun, Moon, planets, and stars change. Let me lift off smoothly to see Earth rotate into darkness and the Moon move around it. Make the sky accurate enough to compare with what I see outside, while making the Earth–Moon system easy to explore on a phone or computer.

## Decisions
- First release -> Earth sky, guided lift-off, and Earth–Moon exploration. Lunar landings and Jupiter come later. (source: user)
- Platform -> A static HTML/CSS/JS project under `druewilding`, suitable for GitHub Pages, with mouse and touch support. (source: user)
- Startup -> Show the current instant. Use the visitor's location when available with permission; for a new visitor without permission, show a clearly labeled example city without prompting automatically. Offer **Use my location** and manual selection. (source: user)
- Observer location -> Select a city from a built-in search or place a pin anywhere on the globe. Changing location keeps the simulation instant fixed and updates the displayed local time. (source: user)
- Time controls -> Separate date and time-of-day dials, play/pause, and **Now**. The date dial preserves the observer's local clock time where possible. Support civil dates from 1900 through 2100 inclusive. (source: user)
- Local sky -> Accurate apparent directions, Sun and Moon apparent sizes, and Moon phase. Use readable planet markers and approximate on-screen brightness. Include labels for planets and selected stars, plus optional constellation lines. (source: user)
- Daylight dimmer -> Reveal stars and planets above the horizon without hiding the Sun, making the ground transparent, or changing the Moon's phase. (source: user)
- Solar events -> Show estimated sunrise, sunset, and daylight duration for the selected date. Identify days when the Sun does not rise or set. (source: user)
- Globe view -> Rise smoothly from the selected site, then orbit and zoom around a simple mapped Earth. Preserve the simulation clock and observer site when lifting off or returning. Maintain true Earth–Moon scale in the 3D view; provide a separate, clearly labeled not-to-scale orbit overview. (source: user)

## Assumptions
- Use the example city if geolocation is denied, unavailable, or times out, without blocking access to the app. A delayed result must not override a newer manual selection. Coordinates and city queries are not sent by the app to a server or saved between visits. No accounts, analytics, or runtime astronomy API. Needs confirmation before release: no.
- Use the selected location's civil time zone when available; use visibly labeled UTC for ocean pins or coordinates without a reliable zone match. Show the zone or UTC offset alongside the clock. Needs confirmation before release: yes.
- If a date change lands in a daylight-saving gap, advance to the first valid local time and indicate the adjustment. When a local time occurs twice, choose the earlier instant for a date edit and show its offset; playback still crosses both occurrences in order. Needs confirmation before release: yes.
- Proposed accuracy targets: within 0.1° for sampled sky directions, 5% relative error for Sun and Moon angular diameters, two percentage points for Moon illumination, and two minutes for sampled non-grazing sunrise and sunset under the same horizon and refraction conventions. Display solar events as estimates for a level horizon, not predictions accounting for local terrain or weather. Needs confirmation before release: yes.
- Start with one simulated second per real second and provide at least one accelerated playback speed. A time edit pauses playback while scrubbing; **Now** returns to live playback. Stop playback at the supported date boundary. Needs confirmation before release: yes.
- Keep the astronomy calculations independent of the renderer. Evaluate a tested JavaScript astronomy library and a browser 3D renderer such as Three.js before choosing dependencies. Bundle licensed city, time-zone, star, constellation, and map data. Needs confirmation before release: no; validate data coverage and licenses before committing to sources.

## Out of scope
- Lunar surface landings, lunar sunrise and sunset, and Earth phases as viewed from the Moon.
- Travel to other planets and the Jupiter system, including close-up views of the Galilean moons.
- Unrestricted free flight, terrain or building detail, and photometrically calibrated brightness or weather-specific visibility.

## Acceptance criteria
1. With a controlled wall clock and no location permission, the app opens the labeled example sky at that instant without requesting permission. **Use my location** applies granted coordinates; denial, timeout, or an unavailable geolocation API leaves the app usable with city search and globe selection. A late response does not replace a newer manual choice.
2. Starting at noon in Reykjavik and selecting Tokyo preserves the UTC instant, updates the observer's local clock, and recomputes the sky for Tokyo. Selecting an arbitrary globe point updates the observer marker and sky; an unresolved time zone is explicitly labeled UTC. Browser network checks confirm the app sends neither coordinates nor city queries.
3. At a location with daylight saving, scrubbing the date across an offset change preserves a valid local clock time while changing its UTC equivalent. Dedicated clock tests cover nonexistent and repeated local times, leap days, local midnight, and both ends of the 1900–2100 range. Play advances time, pause holds it, and **Now** restores the live clock.
4. Compare deterministic astronomy outputs against independent reference fixtures using matching observation and refraction conventions. Include dates near both range endpoints, both hemispheres, and low and high latitudes. Verify apparent directions for the Sun, Moon, planets, and sampled stars, apparent Sun and Moon sizes, and lunar illumination against the agreed tolerances. Verify that waxing and waning are distinguishable at comparable illumination and that the lit side points toward the Sun.
5. Compare sunrise, sunset, and daylight duration for a mid-latitude city at both solstices against reference fixtures. Check a polar-day date, a polar-night date, and a date with only one crossing on the selected local calendar day. Missing events are identified, not shown as midnight; polar-day and polar-night duration reflects the full local day or zero, respectively.
6. For a fixed daytime camera fixture containing stars above and below the horizon, moving the dimmer toward minimum reveals the above-horizon stars without revealing the below-horizon stars or changing the simulation instant, Sun direction, or Moon phase. Planet and star labels and constellation lines can be shown or hidden; constellation lines follow their stars as time advances.
7. From a paused surface view, lift-off continuously changes the camera from the observer location into the globe view. The visitor can orbit and zoom and return to the same location at the same instant. During playback, the labeled surface location moves with Earth's rotation relative to the day/night boundary, and the Moon changes position. Compare sampled globe geometry to Earth and Moon physical sizes and their modeled separation; switching to the visibly labeled not-to-scale overview preserves time.
8. Exercise the core journey using mouse on desktop and touch on a phone: select a location, look around, scrub time, dim daylight, lift off, orbit, zoom, and return. Verify the built site loads from a GitHub Pages project subpath without a backend or runtime API keys. If 3D is unavailable, show a clear compatibility message rather than a blank view.

## Impacted areas
- New static site: geolocation, city and globe selection, observer time and playback, astronomy calculations, sky and globe rendering, labels and constellation overlays.
- Bundled read-only geographic and astronomical datasets; no accounts, backend endpoints, database, or migrations.
- Verification: deterministic clock and astronomy tests, critical desktop and mobile browser journeys, and a GitHub Pages subpath smoke test.

## Open risks
- **High — accuracy and historical time:** An ephemeris, star catalog, and independent fixtures must meet the targets across the full range. Historical time-zone rules, particularly before 1970, may be incomplete; future civil-time rules can change. Disclose these limits and test only against known conventions.
- **Medium — mobile rendering:** Earth-to-Moon scene scale, animation, and dense labels can cause visual artifacts or stutter. Prototype this early and agree on a reference phone and measurable frame-time target before release.
- **Medium — near-horizon events:** Refraction, observer elevation, and grazing solar crossings can materially change real sunrise or sunset. Document what the model assumes and handle ambiguous or missing crossings explicitly.
- **Medium — bundled data:** Confirm redistribution licenses, attribution, size, and coverage for all datasets before selecting them.

GATE: spec awaiting approval
