/** Sleep helper shared by the plugin's handshake wait and the helper's port wait. */

/**
 * Resolve after a fixed delay.
 * @param ms - milliseconds to wait.
 * @returns a promise that settles after the delay.
 */
export function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}
