export type ScrollHider = (scrollTop: number, userDriven?: boolean) => boolean;

export function createScrollHider(threshold: number): ScrollHider {
  let lastTop = 0;
  let travel = 0;
  let hidden = false;
  return (scrollTop, userDriven = true) => {
    const delta = scrollTop - lastTop;
    lastTop = scrollTop;
    if (!userDriven) {
      travel = 0;
      return hidden;
    }
    if (scrollTop <= 0) {
      travel = 0;
      hidden = false;
      return hidden;
    }
    if (delta === 0) return hidden;
    if (Math.sign(delta) !== Math.sign(travel)) travel = 0;
    travel += delta;
    if (travel > threshold) hidden = true;
    else if (travel < -threshold) hidden = false;
    return hidden;
  };
}
