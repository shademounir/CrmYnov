interface ConversationPageProps {
  params: Promise<{ conversationId: string }>;
}

export default async function ConversationPage({ params }: ConversationPageProps): Promise<React.JSX.Element> {
  const { conversationId } = await params;
  const safeReference = /^[a-zA-Z0-9-]{8,64}$/.test(conversationId) ? conversationId : "référence-invalide";

  return (
    <main>
      <h1>Conversation interne</h1>
      <p>Référence technique : <code>{safeReference}</code></p>
      <p>Le contenu sera chargé uniquement après contrôle d’appartenance côté API. Une notification ne confère aucun accès supplémentaire.</p>
      <a href="/chat">Retour aux conversations</a>
    </main>
  );
}
