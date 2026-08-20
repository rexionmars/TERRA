/**
 * The species Helios's plantarchitecture ships, named once.
 *
 * Two canopy editors offer this list and a copy in each is a copy that can
 * disagree with the other -- the same argument `lib/studioEditors.ts` makes for
 * its own table. Mirrored from sidecar/helios_grow.py rather than fetched, so
 * the picker can be offered on a machine with no toolkit installed, which is the
 * common case: pyhelios3d is an optional extra. A name that disappears upstream
 * fails against helios_grow's own list, with a message naming what it ships.
 *
 * Three of the thirty do not grow in this build -- olive, pistachio and walnut --
 * and are absent from data/lai_ladder.json for that reason. They are left in
 * here because the mesh path still grows them; it is the ladder that cannot.
 */
export const SPECIES = [
  "sorghum", "maize", "wheat", "rice", "soybean", "cowpea", "bean",
  "tomato", "cherrytomato", "capsicum", "strawberry", "sugarbeet",
  "asparagus", "butterlettuce", "grapevine_VSP", "grapevine_Wye",
  "almond", "apple", "apple_fruitingwall", "olive", "pistachio", "walnut",
  "easternredbud", "bougainvillea",
] as const
