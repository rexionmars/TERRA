import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * The type scale, as declared in index.css under the --text-* namespace.
 *
 * tailwind-merge has to be told about it. Left to infer, it reads `text-body`
 * as a COLOUR -- the `text-` prefix carries both roles in Tailwind -- so
 * cn("text-body", "text-muted-foreground") resolved the two as one conflict and
 * kept the colour, silently deleting the size. Every component composes its
 * classes through cn, so the whole scale was inert wherever a size and a colour
 * met, which is nearly everywhere.
 *
 * Edited together with the --text-* block in index.css.
 */
const TYPE_SCALE = ["micro", "meta", "body", "emphasis", "heading"] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...TYPE_SCALE] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
