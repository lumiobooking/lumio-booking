/**
 * THE FILE "TEST CONNECTION" WRITES TO THE HOST AND READS BACK.
 *
 * It used to be a .txt. The read-back check then asked "did an IMAGE come
 * back?" — because that check is shared with real uploads, where a web page
 * answering in place of a photo is the failure it exists to catch. A .txt file
 * served perfectly correctly comes back as text/plain, so a storage setup that
 * was completely right was reported as broken, with a sentence blaming the
 * Public URL. That sentence cost a person an evening of re-checking a setting
 * that had nothing wrong with it.
 *
 * The probe is now a real one-pixel PNG. It exercises exactly the path a
 * salon's photo will take — an image, by its extension, served with an image
 * content-type — so the check and the thing it checks finally agree.
 */

/** A valid 1×1 transparent PNG, 67 bytes. Generated once; not decoded from anything. */
export const PROBE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** The probe's file name for one run. Random so two tests never collide. */
export function probeName(id: string): string {
  return `lumio-check-${id}.png`;
}
