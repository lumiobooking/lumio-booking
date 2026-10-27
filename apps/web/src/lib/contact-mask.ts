/**
 * A client contact the server masked for a technician (api common/contact-privacy):
 * "••• 2832" is shown as text, never dialled. Pure.
 */
export const isMaskedContact = (v: string | null | undefined): boolean => !!v && v.includes('•');
