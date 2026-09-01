/**
 * The two things publishing needs from storage, and nothing else.
 *
 * WHY A PORT RATHER THAN THE SERVICE ITSELF
 *
 * SocialPublishService first depended on UploadsService directly. That class
 * imports an FTP client, so every test that touched publishing — tenant
 * isolation, refusal rules, the queue — had to load an FTP library to check
 * something that has nothing to do with FTP. The suite broke the moment that
 * dependency was not installed, and it broke in a way that said nothing about
 * the code under test.
 *
 * Naming the two methods that are actually used keeps the test surface honest:
 * a stub for this interface is two lines, and it cannot drift from reality
 * because the compiler checks UploadsService still satisfies it where it is
 * bound in ContentModule.
 */
export interface MediaStore {
  /** The public URL prefix of our own bucket, or null when storage is off. */
  publicBase(): Promise<string | null>;
  /** Delete files by their path inside our bucket ("<tenant>/<uuid>.jpg"). */
  deletePaths(paths: string[]): Promise<{ deleted: number; failed: number }>;
}

/** DI token. A TypeScript interface has no runtime identity to inject by. */
export const MEDIA_STORE = 'MEDIA_STORE';
