import { CheckIcon } from "../icons";

export function Toast({ message }: { message: string }) {
  return (
    <div className="toast">
      <CheckIcon size={15} style={{ color: "var(--accent)" }} />
      {message}
    </div>
  );
}
