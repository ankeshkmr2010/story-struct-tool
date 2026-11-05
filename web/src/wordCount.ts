/** Words as the server counts them (api narrative/prose.py count_words): runs of letters or
 * digits, joined by an apostrophe or hyphen. Dashes, markdown marks and image embeds are not words. */
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu
const IMAGE = /!\[[^\]\n]*\]\(storytool-image:[0-9a-fA-F-]{36}\)/g

export const countWords = (text: string) => text.replace(IMAGE, '').match(WORD)?.length ?? 0
