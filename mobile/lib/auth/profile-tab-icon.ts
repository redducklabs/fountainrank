/**
 * Decide whether the Profile tab icon should render the user's avatar photo or fall back to the
 * generic glyph. `focused` does not change the decision itself (it only drives the active-state
 * ring styling in `ProfileTabIcon`); it stays part of the signature so the decision reads the same
 * inputs the component has on hand.
 */
export function profileTabIcon(
  avatarUrl: string | null | undefined,
  focused: boolean,
): "image" | "glyph" {
  void focused;
  return avatarUrl ? "image" : "glyph";
}
