import { ScreenContainer } from "../../components/ScreenContainer";
import { EmptyState } from "../../components/states/EmptyState";

export default function AddScreen() {
  return (
    <ScreenContainer>
      <EmptyState label="Adding a fountain becomes available once sign-in ships (slice 6e-7)." />
    </ScreenContainer>
  );
}
