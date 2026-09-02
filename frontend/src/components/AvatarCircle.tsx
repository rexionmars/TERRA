import { User } from "@phosphor-icons/react"

export function AvatarCircle({
  uri,
  size = "md",
}: {
  uri?: string
  size?: "sm" | "md" | "lg"
}) {
  const dim = size === "lg" ? "h-16 w-16" : size === "sm" ? "h-7 w-7" : "h-10 w-10"
  if (uri) {
    return (
      <img
        src={uri}
        alt=""
        className={`${dim} shrink-0 rounded-full border border-border object-cover`}
      />
    )
  }
  return (
    <span
      className={`${dim} flex shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground`}
    >
      <User className={size === "lg" ? "h-7 w-7" : "h-3.5 w-3.5"} />
    </span>
  )
}
