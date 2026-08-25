export default async function BroadcastSummaryPage({ params }: Readonly<{ params: Promise<{ broadcastId: string }> }>): Promise<React.JSX.Element> {
  const { broadcastId } = await params;
  return <main><h1>Résumé du broadcast interne</h1><p>Référence : <code>{broadcastId}</code></p><p>Le détail est soumis au RBAC côté API. Une notification ne confère aucun droit supplémentaire.</p><dl><dt>État</dt><dd>Confirmé</dd><dt>Audience</dt><dd>Snapshot immuable, compte agrégé uniquement</dd><dt>Correction</dt><dd>Nouvelle notification compensatoire obligatoire</dd></dl><a href="/notifications">Retour au centre de notifications</a></main>;
}
