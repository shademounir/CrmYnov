const syntheticMessages = [
  { id: "message-synthetic-1", author: "Conseiller synthétique A", body: "Point interne synthétique, sans donnée candidat.", state: "Envoyé" },
  { id: "message-synthetic-2", author: "Manager synthétique", body: "Décision à convertir explicitement en activité officielle.", state: "Édité — version précédente conservée" },
] as const;

export default function InternalChatPage(): React.JSX.Element {
  return (
    <main>
      <header>
        <h1>Chat interne</h1>
        <p>Conversations réservées aux collaborateurs autorisés. Aucun lead ne peut participer ni recevoir un message.</p>
      </header>

      <section aria-labelledby="conversation-heading">
        <h2 id="conversation-heading">Conversation d’équipe synthétique</h2>
        <p>2 membres actifs · conservation 12 mois · pièces jointes différées</p>
        <ol aria-label="Historique paginé des messages">
          {syntheticMessages.map((message) => (
            <li key={message.id}>
              <article>
                <h3>{message.author}</h3>
                <p>{message.body}</p>
                <small>{message.state}</small>
              </article>
            </li>
          ))}
        </ol>
      </section>

      <form aria-label="Envoyer un message interne">
        <label htmlFor="chat-message">Message</label>
        <textarea id="chat-message" name="content" maxLength={2000} required />
        <p>Le contenu est limité à 2 000 caractères et ne remplace pas une note ou activité officielle du lead.</p>
        <button type="submit">Envoyer</button>
      </form>

      <aside aria-label="Règles de confidentialité">
        <h2>Contrôles appliqués</h2>
        <ul>
          <li>Lecture et envoi contrôlés côté API pour chaque conversation.</li>
          <li>Édition limitée à 60 minutes et version originale conservée.</li>
          <li>Suppression logique motivée et audit sans contenu du message.</li>
        </ul>
      </aside>
    </main>
  );
}
