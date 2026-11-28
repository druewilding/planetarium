// The trail of what you've looked at, for the info panel's back arrow: Saturn, then
// Tethys from its card, then Dione from Tethys's, and back steps through them again.

/**
 * same(a, b): whether two choices are the same thing. stillThere(c): whether you can
 * still go back to it (a mountain you've walked away from, or the Earth once you've
 * landed, isn't there any more).
 */
export function createTrail({ same, stillThere = () => true, limit = 50 }) {
  const steps = [];
  return {
    /** Moving from `from` to `to` (either may be null: null is the overview, where the trail starts again). */
    move(from, to) {
      if (!to) steps.length = 0;
      else if (from && !same(from, to)) {
        steps.push(from);
        if (steps.length > limit) steps.shift();
      }
    },
    /** Take the step back: what to go back to, or null for the overview. */
    back() {
      let prev = steps.pop();
      while (prev && !stillThere(prev)) prev = steps.pop();
      return prev ?? null;
    },
    /** Where the step back would go (null: the overview), without taking it. */
    peek() {
      for (let i = steps.length - 1; i >= 0; i--) if (stillThere(steps[i])) return steps[i];
      return null;
    },
    get length() {
      return steps.length;
    },
  };
}
