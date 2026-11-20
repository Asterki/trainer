import { BottomSheet } from './BottomSheet';
import { SessionDetail } from './SessionDetail';
import type { Session } from '../domain/types';

interface SessionDetailSheetProps {
  session: Session | null;
  onClose: () => void;
}

export function SessionDetailSheet({ session, onClose }: SessionDetailSheetProps) {
  return (
    <BottomSheet open={session !== null} title="Session detail" onClose={onClose}>
      {session ? <SessionDetail session={session} /> : null}
    </BottomSheet>
  );
}
