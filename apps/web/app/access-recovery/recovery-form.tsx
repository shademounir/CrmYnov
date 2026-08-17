"use client";

import { useState } from "react";

const GENERIC_MESSAGE = "Si le compte est éligible, les instructions de récupération seront fournies.";

export function RecoveryForm(): React.JSX.Element {
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    const data = new FormData(event.currentTarget);
    try {
      await fetch("http://localhost:3001/access-recovery/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), returnPath: "/access-recovery/complete" }),
      });
    } finally {
      setPending(false);
      setMessage(GENERIC_MESSAGE);
    }
  }

  return (
    <form onSubmit={(event) => { void submit(event); }} aria-describedby="recovery-guidance">
      <label htmlFor="recovery-email">Adresse professionnelle</label>
      <input id="recovery-email" name="email" type="email" autoComplete="email" maxLength={254} required />
      <p id="recovery-guidance">La réponse reste identique, que le compte existe ou non.</p>
      <button type="submit" disabled={pending}>{pending ? "Envoi…" : "Demander la récupération"}</button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}

export { GENERIC_MESSAGE };
