using System.Drawing.Drawing2D;
using System.Net;

namespace CrmYnov.TelephonyAgent;

internal sealed class MainForm : Form
{
    private static readonly Icon ProductIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
    private static readonly Color Navy = Color.FromArgb(7, 34, 68);
    private static readonly Color Teal = Color.FromArgb(21, 177, 168);
    private static readonly Color Surface = Color.FromArgb(242, 246, 250);
    private static readonly Color Muted = Color.FromArgb(93, 111, 128);
    private static readonly Color Success = Color.FromArgb(10, 116, 104);
    private static readonly Color Danger = Color.FromArgb(181, 45, 48);

    private readonly DpapiStore store;
    private readonly AgentSetup setup;
    private readonly AgentRuntime runtime;
    private readonly ProtocolBroker protocolBroker;
    private readonly ProtocolRequest? startupRequest;
    private readonly NotifyIcon tray;
    private readonly Panel contentHost = new() { Dock = DockStyle.Fill, AutoScroll = true };
    private readonly Label feedback = new() { AutoSize = true, MaximumSize = new Size(760, 0), ForeColor = Muted, Margin = new Padding(0, 10, 0, 0) };
    private readonly System.Windows.Forms.Timer audioTimer = new() { Interval = 150 };

    private AgentRuntimeSnapshot snapshot = new(false, false, false, false, "ARRÊTÉ", null, null, false, 0, [], null, null);
    private ComboBox? inputDevices;
    private ComboBox? outputDevices;
    private ProgressBar? microphoneLevel;
    private Label? microphoneLevelText;
    private Button? microphoneTestButton;
    private CheckBox? localMonitoring;
    private Button? finishButton;
    private Label? readinessLabel;
    private Label? crmStatus;
    private Label? authorizationStatus;
    private Label? sipStatus;
    private Label? audioStatus;
    private Label? callValue;
    private Label? durationValue;
    private Label? accountDisplayValue;
    private Label? microphoneDisplayValue;
    private Label? outputDisplayValue;
    private Button? connectButton;
    private Button? disconnectButton;
    private TextBox? pairingCode;
    private TextBox? workstationName;
    private TextBox? crmAddress;
    private TextBox? sipPassword;
    private TextBox? freeCallPhone;
    private TextBox? freeCallComment;
    private ComboBox? freeCallDestinationType;
    private ComboBox? freeCallPurpose;
    private Button? freeCallButton;
    private Button? freeCallClearButton;
    private bool wizardVisible;
    private int wizardStep;
    private bool allowClose;
    private volatile bool closing;
    private bool closeCompleted;
    private bool withdrawalBusy;
    private readonly AgentUiOperationGate operationGate = new();
    private bool operationBusy => operationGate.IsBusy;
    private Task? operationTask;
    private Button? reassociateButton;
    private Task? withdrawalTask;
    private CancellationTokenSource? withdrawalCancellation;

    public MainForm(DpapiStore store, ProtocolRequest? startupRequest = null)
    {
        this.store = store;
        this.startupRequest = startupRequest;
        setup = new AgentSetup(store);
        runtime = new AgentRuntime(store);
        runtime.SnapshotChanged += OnSnapshotChanged;
        protocolBroker = new ProtocolBroker(HandleBrokerRequestAsync);

        Text = "CRM Ynov · Agent téléphonique";
        Icon = ProductIcon;
        BackColor = Surface;
        ForeColor = Navy;
        Font = new Font("Segoe UI", 9.5f);
        MinimumSize = new Size(780, 650);
        Size = new Size(980, 780);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        DoubleBuffered = true;

        tray = new NotifyIcon {
            Icon = ProductIcon,
            Text = "CRM Ynov · Agent téléphonique",
            Visible = true,
            ContextMenuStrip = BuildTrayMenu(),
        };
        tray.DoubleClick += (_, _) => RestoreWindow();

        Controls.Add(contentHost);
        contentHost.SizeChanged += (_, _) => {
            if (contentHost.Controls.Count > 0) contentHost.Controls[0].Width = Math.Max(0, contentHost.ClientSize.Width - SystemInformation.VerticalScrollBarWidth);
        };
        FormClosing += OnFormClosing;
        Shown += async (_, _) => await InitializeViewAsync();
        audioTimer.Tick += (_, _) => runtime.TickAudio();
        audioTimer.Start();
    }

    private async Task InitializeViewAsync()
    {
        if (runtime.WithdrawalPending) { Render(); ShowFeedback("Un retrait reste à vérifier. Seule la consultation du même reçu est autorisée ; le profil et le journal sont conservés.", true); return; }
        var settings = setup.Settings;
        if (settings is null) { wizardVisible = true; wizardStep = 0; }
        else if (settings.SipPassword.Length == 0) { wizardVisible = true; wizardStep = 1; }
        else if (!setup.IsProfileComplete(settings)) { wizardVisible = true; wizardStep = 3; }
        else { wizardVisible = false; wizardStep = 4; }

        Render();
        if (settings is not null && settings.SipPassword.Length > 0)
        {
            try { await runtime.EnsureAudioAsync(); }
            catch (Exception error) { ShowFeedback(HumanError(error), true); }
        }
        if (startupRequest is not null) await HandleProtocolRequestAsync(startupRequest);
    }

    private Task HandleBrokerRequestAsync(ProtocolRequest request)
    {
        if (closing || IsDisposed) return Task.CompletedTask;
        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        BeginInvoke(async () => {
            if (closing || IsDisposed) { completion.TrySetResult(); return; }
            try { await HandleProtocolRequestAsync(request); completion.SetResult(); }
            catch (Exception error) { completion.SetException(error); }
        });
        return completion.Task;
    }

    private async Task HandleProtocolRequestAsync(ProtocolRequest request)
    {
        if (closing || IsDisposed) return;
        RestoreWindow();
        if (operationBusy) { ShowFeedback("Une opération sur le poste est en cours. Aucune commande d’appel supplémentaire n’a été lancée.", true); return; }
        if (withdrawalBusy || runtime.WithdrawalPending) { Render(); ShowFeedback("Retrait en attente : aucune commande d’appel ni nouvelle connexion n’est autorisée.", true); return; }
        if (request.CommandId is not Guid commandId) {
            ShowFeedback("Agent ouvert. Connectez le poste avant de confirmer un appel dans le CRM.", false);
            return;
        }
        try
        {
            ShowFeedback("Commande CRM reçue. Vérification du poste et de l’autorisation…", false);
            await runtime.HandleProtocolCommandAsync(commandId);
            ShowFeedback("Commande vérifiée auprès du CRM. La numérotation dépend maintenant des événements Liblinphone.", false);
        }
        catch (Exception error) { ShowFeedback(HumanError(error), true); }
    }

    private void Render()
    {
        contentHost.SuspendLayout();
        // Clear does not dispose controls; retain the shared feedback label but
        // release abandoned wizard/dashboard controls on every transition.
        feedback.Parent?.Controls.Remove(feedback);
        var previous = contentHost.Controls.Cast<Control>().ToArray();
        contentHost.Controls.Clear();
        foreach (var old in previous) old.Dispose();
        inputDevices = null; outputDevices = null; microphoneLevel = null; microphoneLevelText = null; microphoneTestButton = null; localMonitoring = null;
        finishButton = null; readinessLabel = null; crmStatus = null; authorizationStatus = null; sipStatus = null; audioStatus = null;
        callValue = null; durationValue = null; connectButton = null; disconnectButton = null; reassociateButton = null;
        accountDisplayValue = null; microphoneDisplayValue = null; outputDisplayValue = null;
        freeCallPhone = null; freeCallComment = null; freeCallPurpose = null; freeCallButton = null; freeCallClearButton = null;
        var view = withdrawalBusy || runtime.WithdrawalPending ? BuildWithdrawalPending() : wizardVisible ? BuildWizard() : BuildDashboard();
        view.Width = Math.Max(0, contentHost.ClientSize.Width - SystemInformation.VerticalScrollBarWidth);
        contentHost.Controls.Add(view);
        contentHost.ResumeLayout(true);
        UpdateVisibleState();
    }

    private Control BuildWizard()
    {
        var root = Page();
        root.Controls.Add(BuildBrandHeader("Configurer mon poste", "Cinq étapes guidées, à réaliser une seule fois sur ce poste."));
        root.Controls.Add(BuildStepIndicator());
        var card = Card(); card.Padding = new Padding(26); card.Margin = new Padding(0, 0, 0, 16);
        card.Controls.Add(wizardStep switch {
            0 => BuildPairingStep(),
            1 => BuildProfileStep(),
            2 => BuildSecretStep(),
            3 => BuildAudioStep(true),
            _ => BuildAvailabilityStep(),
        });
        root.Controls.Add(card);
        if (setup.Settings is not null) { var withdraw = ActionButton("Retirer mon profil", false); withdraw.Click += async (_, _) => await WithdrawAsync(false); root.Controls.Add(withdraw); }
        return root;
    }

    private Control BuildWithdrawalPending()
    {
        var root = Page();
        root.Controls.Add(BuildBrandHeader("Retrait du profil", "Le compte CRM, les historiques, le journal local et les préférences de démarrage sont conservés."));
        var card = Card(); var form = FormStack();
        form.Controls.Add(SectionTitle(withdrawalBusy ? "Vérification en cours" : "Résultat à vérifier", "Aucune nouvelle demande de retrait ne sera envoyée. Une réponse absente ou un reçu introuvable ne prouvent pas un échec : le profil est conservé jusqu’au reçu validé."));
        var actions = ButtonRow();
        var verify = ActionButton("Vérifier le reçu", true); verify.Enabled = !withdrawalBusy; verify.Click += async (_, _) => await WithdrawAsync(true);
        var quit = ActionButton("Quitter", false); quit.Click += (_, _) => { allowClose = true; Close(); };
        actions.Controls.Add(verify); actions.Controls.Add(quit); form.Controls.Add(actions); form.Controls.Add(feedback); card.Controls.Add(form); root.Controls.Add(card);
        return root;
    }

    private async Task WithdrawAsync(bool resumeOnly)
    {
        if (withdrawalBusy || closing) return;
        if (!resumeOnly && MessageBox.Show(this,
            "Retirer uniquement le profil téléphonique protégé de ce poste après confirmation du CRM ? Le compte CRM, les Leads, les historiques, le journal local et vos préférences de démarrage seront conservés. Aucun appel ne sera lancé.",
            "Retirer mon profil", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
        withdrawalBusy = true;
        withdrawalCancellation = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        Render();
        try {
            withdrawalTask = runtime.WithdrawProfileAsync(resumeOnly, withdrawalCancellation.Token);
            await withdrawalTask;
            wizardVisible = true; wizardStep = 0;
            ShowFeedback("Retrait confirmé et profil local retiré. Les historiques sont conservés. Vous pouvez utiliser le parcours officiel d’association.", false);
        } catch (Exception error) { ShowFeedback(WithdrawalError(error), true); }
        finally {
            withdrawalBusy = false;
            withdrawalCancellation.Dispose(); withdrawalCancellation = null;
            if (!closing && !IsDisposed) Render();
        }
    }

    private Control BuildStepIndicator()
    {
        var labels = new[] { "Compte CRM", "Profil", "Mot de passe", "Audio", "Disponibilité" };
        var row = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = labels.Length, Margin = new Padding(0, 0, 0, 16) };
        for (var index = 0; index < labels.Length; index++)
        {
            row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 20));
            row.Controls.Add(new Label {
                AutoSize = false, Dock = DockStyle.Fill, Height = 36, TextAlign = ContentAlignment.MiddleCenter,
                Text = $"{index + 1}. {labels[index]}", Font = new Font("Segoe UI", 8.5f, index == wizardStep ? FontStyle.Bold : FontStyle.Regular),
                BackColor = index <= wizardStep ? Color.FromArgb(225, 247, 244) : Color.White,
                ForeColor = index <= wizardStep ? Success : Muted, Margin = new Padding(index == 0 ? 0 : 4, 0, 0, 0),
            }, index, 0);
        }
        return row;
    }

    private Control BuildPairingStep()
    {
        crmAddress = Field(setup.Settings?.ApiBaseUrl ?? AgentSetup.ConfiguredApiBaseUrl); crmAddress.AccessibleName = "Adresse HTTPS du CRM";
        pairingCode = Field(""); pairingCode.UseSystemPasswordChar = true; pairingCode.AccessibleName = "Code d’association temporaire";
        workstationName = Field(Environment.MachineName); workstationName.AccessibleName = "Nom du poste";
        var form = FormStack();
        form.Controls.Add(SectionTitle("Associer mon compte CRM", "Depuis Mon compte · Téléphonie, relevez la passerelle HTTPS et générez votre code personnel temporaire. Votre extension reste attribuée par l’administration."));
        form.Controls.Add(Labeled("Passerelle HTTPS de l’agent (URL complète)", crmAddress));
        form.Controls.Add(InfoBox("Adresse exacte", "Recopiez la passerelle affichée par le CRM, y compris /agent/ lorsqu’il est présent. Aucun environnement n’est déduit du nom de domaine et aucun basculement automatique n’est effectué."));
        form.Controls.Add(InfoBox("Changement d’environnement", "Une autre origine exige une nouvelle association. Le jeton, le secret SIP et les périphériques de l’ancien profil ne sont jamais transférés automatiquement."));
        form.Controls.Add(Labeled("Code d’association", pairingCode));
        form.Controls.Add(Labeled("Nom de ce poste", workstationName));
        var button = ActionButton("Associer ce poste", true); button.Click += async (_, _) => await PairAsync(); form.Controls.Add(button);
        form.Controls.Add(feedback);
        return form;
    }

    private Control BuildProfileStep()
    {
        var settings = setup.Settings;
        var form = FormStack();
        form.Controls.Add(SectionTitle("Confirmer mon profil téléphonique", "Vérifiez l’identité attribuée par l’administration avant d’enregistrer votre mot de passe téléphonique."));
        form.Controls.Add(SummaryRow("Compte CRM", AccountLabel(settings)));
        form.Controls.Add(SummaryRow("Poste", settings?.WorkstationDisplayName ?? Environment.MachineName));
        form.Controls.Add(SummaryRow("Profil téléphonique", settings is null ? "Non attribué" : MaskSip(settings.SipAddress)));
        form.Controls.Add(SummaryRow("Infrastructure", "Paramètres administrés · non modifiables ici"));
        var actions = ButtonRow();
        var reassociate = ActionButton("Utiliser un autre code", false); reassociate.Click += (_, _) => { wizardStep = 0; Render(); };
        var confirm = ActionButton("Confirmer ce profil", true); confirm.Click += (_, _) => { wizardStep = 2; Render(); };
        actions.Controls.Add(reassociate); actions.Controls.Add(confirm); form.Controls.Add(actions); form.Controls.Add(feedback);
        return form;
    }

    private Control BuildSecretStep()
    {
        sipPassword = Field(""); sipPassword.UseSystemPasswordChar = true; sipPassword.AccessibleName = "Mot de passe téléphonique";
        var form = FormStack();
        form.Controls.Add(SectionTitle("Protéger mon mot de passe téléphonique", "Il reste sur ce PC, protégé par Windows pour votre session. Il n’est jamais envoyé au CRM."));
        form.Controls.Add(Labeled("Mot de passe téléphonique", sipPassword));
        form.Controls.Add(InfoBox("Protection locale", "Votre mot de passe n’apparaît ni dans les journaux, ni dans les diagnostics exportés."));
        var button = ActionButton("Enregistrer et continuer", true); button.Click += async (_, _) => await ConfigureSecretAsync(); form.Controls.Add(button);
        form.Controls.Add(feedback);
        return form;
    }

    private Control BuildAudioStep(bool wizard)
    {
        inputDevices = DeviceCombo(); inputDevices.AccessibleName = "Microphone";
        outputDevices = DeviceCombo(); outputDevices.AccessibleName = "Casque ou haut-parleur";
        microphoneLevel = new ProgressBar { Minimum = 0, Maximum = 100, Width = 520, Height = 20, AccessibleName = "Niveau du microphone" };
        microphoneLevelText = new Label { AutoSize = true, ForeColor = Muted, Margin = new Padding(0, 4, 0, 0), Text = "Lancez le test puis parlez normalement." };
        var form = FormStack();
        form.Controls.Add(SectionTitle("Choisir et tester mes périphériques", "Les tests sont locaux : aucun appel n’est lancé et aucun fichier audio n’est créé."));
        form.Controls.Add(Labeled("Microphone", inputDevices));
        form.Controls.Add(Labeled("Casque ou haut-parleur", outputDevices));
        form.Controls.Add(Labeled("Niveau du microphone", microphoneLevel));
        form.Controls.Add(microphoneLevelText);
        localMonitoring = new CheckBox {
            AutoSize = true,
            Checked = false,
            Text = "Réécouter un court échantillon après le test (optionnel)",
            AccessibleName = "Réécouter un court échantillon du microphone après le test",
            ForeColor = Navy,
            Margin = new Padding(0, 8, 0, 2),
        };
        form.Controls.Add(localMonitoring);
        form.Controls.Add(new Label {
            AutoSize = true,
            ForeColor = Muted,
            MaximumSize = new Size(720, 0),
            Text = "Désactivée par défaut. Jusqu’à cinq secondes restent uniquement en mémoire, puis sont rejouées une fois et effacées. Aucun retour en direct ni fichier audio.",
        });
        var testRow = ButtonRow();
        var refresh = ActionButton("Actualiser", false); refresh.Click += async (_, _) => await RefreshDevicesAsync();
        microphoneTestButton = ActionButton("Tester le microphone", false); microphoneTestButton.Click += async (_, _) => await ToggleMicrophoneTestAsync();
        var outputTest = ActionButton("Tester la sortie", false); outputTest.Click += async (_, _) => await PlayOutputTestAsync();
        testRow.Controls.Add(refresh); testRow.Controls.Add(microphoneTestButton); testRow.Controls.Add(outputTest); form.Controls.Add(testRow);
        var apply = ActionButton(wizard ? "Enregistrer et continuer" : "Enregistrer les périphériques", true);
        apply.Click += (_, _) => SaveDevices(wizard); form.Controls.Add(apply);
        form.Controls.Add(InfoBox("Pendant un appel", "Un casque retiré n’est jamais remplacé silencieusement par les haut-parleurs. L’appel est interrompu et le problème est signalé."));
        form.Controls.Add(feedback);
        FillDeviceCombos();
        return form;
    }

    private Control BuildAvailabilityStep()
    {
        var form = FormStack();
        form.Controls.Add(SectionTitle("Vérifier la disponibilité", "La configuration est enregistrée. La disponibilité réelle exige le CRM, l’autorisation du poste, le SIP et les deux périphériques."));
        var status = BuildFourStatusCards(); form.Controls.Add(status);
        readinessLabel = new Label { AutoSize = true, MaximumSize = new Size(720, 0), Font = new Font("Segoe UI", 12, FontStyle.Bold), Margin = new Padding(0, 16, 0, 10) };
        form.Controls.Add(readinessLabel);
        var actions = ButtonRow();
        connectButton = ActionButton("Connecter le poste", true); connectButton.Click += async (_, _) => await ConnectAsync();
        disconnectButton = ActionButton("Déconnecter", false); disconnectButton.Click += async (_, _) => await DisconnectAsync();
        finishButton = ActionButton("Ouvrir le tableau de bord", true); finishButton.Click += (_, _) => { wizardVisible = false; Render(); };
        actions.Controls.Add(connectButton); actions.Controls.Add(disconnectButton); actions.Controls.Add(finishButton); form.Controls.Add(actions);
        form.Controls.Add(feedback);
        return form;
    }

    private Control BuildDashboard()
    {
        var root = Page();
        root.Controls.Add(BuildBrandHeader("Mon poste téléphonique", "Profil enregistré, disponibilité en temps réel et appels sortants tracés."));

        var availability = Card(); availability.Padding = new Padding(20); availability.Margin = new Padding(0, 0, 0, 14);
        var stack = FormStack();
        readinessLabel = new Label { AutoSize = true, Font = new Font("Segoe UI", 15, FontStyle.Bold), Margin = new Padding(0, 0, 0, 12) };
        stack.Controls.Add(readinessLabel); stack.Controls.Add(BuildFourStatusCards()); availability.Controls.Add(stack); root.Controls.Add(availability);

        var profile = Card(); profile.Padding = new Padding(20); profile.Margin = new Padding(0, 0, 0, 14);
        var profileStack = FormStack(); profileStack.Controls.Add(SectionTitle("Profil enregistré", "Cette configuration reste disponible après fermeture et réouverture de l’agent."));
        var settings = setup.Settings;
        accountDisplayValue = SummaryValue(AccountLabel(settings));
        profileStack.Controls.Add(SummaryRow("Compte CRM", accountDisplayValue));
        profileStack.Controls.Add(SummaryRow("Environnement CRM", settings is null ? "Non configuré" : AgentSetup.EnvironmentLabel(settings.ApiBaseUrl)));
        profileStack.Controls.Add(SummaryRow("Poste associé", settings?.WorkstationDisplayName ?? Environment.MachineName));
        profileStack.Controls.Add(SummaryRow("Profil téléphonique", settings is null ? "Non configuré" : MaskSip(settings.SipAddress)));
        microphoneDisplayValue = SummaryValue(DeviceLabel(snapshot.InputDeviceId, true));
        outputDisplayValue = SummaryValue(DeviceLabel(snapshot.OutputDeviceId, false));
        profileStack.Controls.Add(SummaryRow("Microphone", microphoneDisplayValue));
        profileStack.Controls.Add(SummaryRow("Sortie", outputDisplayValue));
        var profileActions = ButtonRow();
        var modify = ActionButton("Modifier", false); modify.Click += async (_, _) => { wizardVisible = true; wizardStep = 3; Render(); await EnsureAudioForViewAsync(); };
        reassociateButton = ActionButton("Réassocier le poste", false);
        reassociateButton.Click += async (_, _) => await ReassociateAsync();
        connectButton = ActionButton("Connecter", true); connectButton.Click += async (_, _) => await ConnectAsync();
        disconnectButton = ActionButton("Déconnecter", false); disconnectButton.Click += async (_, _) => await DisconnectAsync();
        var quit = ActionButton("Quitter", false); quit.Click += (_, _) => { allowClose = true; Close(); };
        var withdraw = ActionButton("Retirer mon profil", false); withdraw.Click += async (_, _) => await WithdrawAsync(false);
        var reconcile = ActionButton("Vérifier les demandes en attente", false);
        reconcile.Click += async (_, _) => {
            reconcile.Enabled = false;
            try {
                var result = await runtime.ReconcileFreeCallsAsync();
                ShowFeedback(result.Remaining == 0
                    ? $"Vérification terminée : {result.Resolved} demande(s) rapprochée(s). Aucun appel déclenché par cette vérification."
                    : $"{result.Remaining} demande(s) restent incertaines. Le journal est conservé ; ne répétez pas la composition.", result.Remaining != 0);
            }
            catch (Exception error) { ShowFeedback(HumanError(error), true); }
            finally { if (!reconcile.IsDisposed) reconcile.Enabled = true; }
        };
        profileActions.Controls.Add(modify); profileActions.Controls.Add(reassociateButton); profileActions.Controls.Add(connectButton); profileActions.Controls.Add(disconnectButton); profileActions.Controls.Add(withdraw); profileActions.Controls.Add(quit);
        reconcile.Margin = new Padding(0, 10, 0, 0);
        profileStack.Controls.Add(profileActions); profileStack.Controls.Add(reconcile); profileStack.Controls.Add(feedback); profile.Controls.Add(profileStack); root.Controls.Add(profile);

        root.Controls.Add(BuildCallCard());
        var tabs = new TabControl { Dock = DockStyle.Top, Height = 420, Padding = new Point(14, 7), Margin = new Padding(0, 0, 0, 16) };
        tabs.TabPages.Add(Tab("Audio", BuildAudioStep(false)));
        tabs.TabPages.Add(Tab("Composer", BuildDialPad()));
        tabs.TabPages.Add(Tab("Diagnostic", BuildDiagnosticPage()));
        root.Controls.Add(tabs);
        return root;
    }

    private Control BuildDialPad()
    {
        var form = FormStack();
        form.Controls.Add(SectionTitle("Appeler un numéro autorisé", "Ce parcours reste relié au CRM : droit, type de destination, motif, commande et événements sont vérifiés côté serveur."));
        freeCallDestinationType = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 520, AccessibleName = "Type de destination" };
        freeCallDestinationType.Items.AddRange([
            new DestinationTypeItem("MOROCCO", "Numéro marocain"),
            new DestinationTypeItem("INTERNATIONAL", "Numéro international (+ indicatif)"),
            new DestinationTypeItem("EXTENSION", "Extension interne"),
        ]);
        freeCallDestinationType.SelectedIndex = 0;
        form.Controls.Add(Labeled("Type de destination", freeCallDestinationType));
        freeCallPhone = Field(""); freeCallPhone.AccessibleName = "Numéro à appeler"; freeCallPhone.PlaceholderText = "06 00 00 00 00";
        freeCallPhone.Enter += (_, _) => { if (freeCallPhone.TextLength > 0) freeCallPhone.SelectAll(); };
        freeCallPhone.TextChanged += (_, _) => {
            if (freeCallClearButton is not null) freeCallClearButton.Enabled = !AgentCallState.IsActive(snapshot.CallState) && freeCallPhone.TextLength > 0;
        };
        form.Controls.Add(Labeled("Numéro ou extension", freeCallPhone));
        freeCallDestinationType.SelectedIndexChanged += (_, _) => {
            if (freeCallDestinationType.SelectedItem is not DestinationTypeItem type || freeCallPhone is null) return;
            freeCallPhone.PlaceholderText = type.Code switch { "INTERNATIONAL" => "+33 6 00 00 00 00", "EXTENSION" => "0211", _ => "06 00 00 00 00" };
            freeCallPhone.AccessibleName = type.Code == "EXTENSION" ? "Extension interne" : "Numéro à appeler";
        };
        var keypad = new TableLayoutPanel { AutoSize = true, ColumnCount = 3, Margin = new Padding(0, 0, 0, 12) };
        var keys = new[] { "1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0", "⌫" };
        for (var index = 0; index < keys.Length; index++) {
            var label = keys[index];
            var key = ActionButton(label, false); key.Width = 94; key.AccessibleName = label == "⌫" ? "Effacer le dernier chiffre" : $"Chiffre {label}";
            key.Click += (_, _) => {
                if (freeCallPhone is null) return;
                var edit = DialPadEditor.Apply(freeCallPhone.Text, freeCallPhone.SelectionStart, freeCallPhone.SelectionLength, label);
                freeCallPhone.Text = edit.Text;
                freeCallPhone.Focus();
                freeCallPhone.SelectionStart = edit.Caret;
            };
            keypad.Controls.Add(key, index % 3, index / 3);
        }
        form.Controls.Add(keypad);
        freeCallClearButton = ActionButton("Effacer le numéro", false);
        freeCallClearButton.AccessibleName = "Effacer tout le numéro";
        freeCallClearButton.Click += (_, _) => { if (freeCallPhone is null) return; freeCallPhone.Clear(); freeCallPhone.Focus(); };
        form.Controls.Add(freeCallClearButton);
        freeCallPurpose = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 520, AccessibleName = "Motif de l’appel" };
        freeCallPurpose.Items.AddRange([new PurposeItem("PROSPECT_CALLBACK", "Rappel d’un prospect"), new PurposeItem("PARTNER", "Partenaire autorisé"), new PurposeItem("OTHER_AUTHORIZED", "Autre appel professionnel autorisé")]);
        freeCallPurpose.SelectedIndex = 0; form.Controls.Add(Labeled("Motif obligatoire", freeCallPurpose));
        freeCallComment = Field(""); freeCallComment.AccessibleName = "Commentaire facultatif"; freeCallComment.MaxLength = 500;
        form.Controls.Add(Labeled("Commentaire facultatif", freeCallComment));
        freeCallButton = ActionButton("Vérifier et appeler", true); freeCallButton.Click += async (_, _) => await StartFreeCallAsync(); form.Controls.Add(freeCallButton);
        form.Controls.Add(InfoBox("Traçabilité", "Le numéro n’est jamais placé dans le protocole Windows ni dans le diagnostic. Un appel sans Lead reste dans la file « À vérifier » jusqu’à un rapprochement manuel audité."));
        return form;
    }

    private async Task StartFreeCallAsync()
    {
        if (freeCallPhone is null || freeCallDestinationType?.SelectedItem is not DestinationTypeItem destinationType || freeCallPurpose?.SelectedItem is not PurposeItem purpose) return;
        freeCallButton!.Enabled = false;
        try {
            await runtime.StartFreeCallAsync(freeCallPhone.Text, destinationType.Code, purpose.Code, freeCallComment?.Text);
            ShowFeedback("Demande enregistrée et vérifiée. La numérotation est maintenant suivie par Liblinphone.", false);
        }
        catch (Exception error) { ShowFeedback(HumanError(error), true); }
        finally { freeCallButton.Enabled = AgentReadiness.IsReady(snapshot) && !AgentCallState.IsActive(snapshot.CallState); }
    }

    private Control BuildFourStatusCards()
    {
        var grid = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 4, Margin = new Padding(0) };
        for (var index = 0; index < 4; index++) grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));
        crmStatus = StatusValue(); authorizationStatus = StatusValue(); sipStatus = StatusValue(); audioStatus = StatusValue();
        grid.Controls.Add(StatusCard("CRM", crmStatus), 0, 0);
        grid.Controls.Add(StatusCard("POSTE", authorizationStatus), 1, 0);
        grid.Controls.Add(StatusCard("SIP", sipStatus), 2, 0);
        grid.Controls.Add(StatusCard("AUDIO", audioStatus), 3, 0);
        return grid;
    }

    private Control BuildCallCard()
    {
        var panel = Card(); panel.Padding = new Padding(18); panel.Margin = new Padding(0, 0, 0, 14);
        var row = new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, ColumnCount = 3 };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var text = FormStack(); text.Controls.Add(new Label { AutoSize = true, Text = "APPEL COURANT", Font = new Font("Segoe UI", 8, FontStyle.Bold), ForeColor = Teal });
        callValue = new Label { AutoSize = true, Font = new Font("Segoe UI", 11, FontStyle.Bold), ForeColor = Navy };
        durationValue = new Label { AutoSize = true, ForeColor = Muted }; text.Controls.Add(callValue); text.Controls.Add(durationValue);
        var mute = ActionButton("Couper le micro", false); mute.Name = "mute"; mute.Click += (_, _) => runtime.SetMuted(!snapshot.Muted);
        var hangup = ActionButton("Raccrocher", false); hangup.Name = "hangup"; hangup.Click += (_, _) => runtime.Hangup();
        row.Controls.Add(text, 0, 0); row.Controls.Add(mute, 1, 0); row.Controls.Add(hangup, 2, 0); panel.Controls.Add(row); return panel;
    }

    private Control BuildDiagnosticPage()
    {
        var form = FormStack();
        form.Controls.Add(SectionTitle("Diagnostic expurgé", "L’export exclut secrets, jetons, numéros, identités SIP et noms de périphériques."));
        var export = ActionButton("Exporter le diagnostic", false); export.Click += (_, _) => ExportDiagnostic(); form.Controls.Add(export);
        var autoStart = new CheckBox { AutoSize = true, Text = "Démarrer automatiquement avec ma session Windows", Checked = StartupManager.Enabled, Margin = new Padding(0, 12, 0, 0) };
        autoStart.CheckedChanged += (_, _) => { try { StartupManager.Enabled = autoStart.Checked; } catch { autoStart.Checked = StartupManager.Enabled; ShowFeedback("Le démarrage automatique n’a pas pu être modifié.", true); } };
        form.Controls.Add(autoStart);
        form.Controls.Add(InfoBox("Confidentialité", "Réception et enregistrement audio restent désactivés. Les détails techniques sont réservés au diagnostic expurgé."));
        return form;
    }

    private async Task PairAsync()
    {
        if (operationBusy || closing || withdrawalBusy) return;
        if (crmAddress is null || pairingCode is null || workstationName is null || string.IsNullOrWhiteSpace(crmAddress.Text) || string.IsNullOrWhiteSpace(pairingCode.Text) || string.IsNullOrWhiteSpace(workstationName.Text)) { ShowFeedback("Renseignez l’adresse CRM, le code d’association et le nom du poste.", true); return; }
        // Capture the submitted values before yielding; another view must not
        // change which endpoint/code/name the in-flight single attempt uses.
        var address = crmAddress.Text; var code = pairingCode.Text; var name = workstationName.Text;
        await RunOperationAsync("Association en cours… Ne renvoyez pas le code ; le profil précédent reste conservé jusqu’à confirmation.", async () => {
            await runtime.WithProfileMaintenanceAsync(async () => {
                await setup.PairAsync(address, code, name, CancellationToken.None);
            });
            pairingCode?.Clear(); wizardStep = 1;
            if (!closing) { ShowFeedback("Poste associé. Vérifiez maintenant le profil attribué.", false); Render(); }
        });
    }

    private async Task ConfigureSecretAsync()
    {
        try
        {
            if (sipPassword is null) return;
            await runtime.WithProfileMaintenanceAsync(() => {
                setup.ConfigureSecret(sipPassword.Text);
                return Task.CompletedTask;
            });
            sipPassword.Clear();
            await runtime.ResetAudioAsync(); wizardStep = 3;
            ShowFeedback("Mot de passe téléphonique protégé par Windows sur ce poste.", false); Render();
        }
        catch (Exception error) { ShowFeedback(HumanError(error), true); }
    }

    private async Task EnsureAudioForViewAsync()
    {
        try { await runtime.EnsureAudioAsync(); FillDeviceCombos(); }
        catch (Exception error) { ShowFeedback(HumanError(error), true); }
    }

    private void SaveDevices(bool continueWizard)
    {
        try
        {
            var input = inputDevices?.SelectedItem as AudioDeviceItem;
            var output = outputDevices?.SelectedItem as AudioDeviceItem;
            if (input is null || output is null) throw new InvalidOperationException("AUDIO_DEVICE_UNAVAILABLE");
            runtime.ApplyDevices(input.Id, output.Id);
            ShowFeedback("Périphériques enregistrés pour ce poste.", false);
            if (continueWizard) { runtime.StopMicrophoneTest(); wizardStep = 4; Render(); }
            else Render();
        }
        catch (Exception error) { ShowFeedback(HumanError(error), true); }
    }

    private Task RefreshDevicesAsync() => RunOperationAsync("Actualisation de l’audio local…", () =>
        AgentLocalAudioAction.RunAsync(runtime.EnsureAudioAsync, () => {
            if (closing) return;
            runtime.RefreshAudioDevices(); FillDeviceCombos();
            ShowFeedback("Liste des périphériques actualisée. Aucune reconnexion téléphonique.", false);
        }));

    private Task ToggleMicrophoneTestAsync() => RunOperationAsync("Préparation du test audio local…", async () => {
            if (snapshot.AudioTestActive) { runtime.StopMicrophoneTest(); ShowFeedback("Test microphone arrêté. Aucun son n’a été enregistré.", false); }
            else await AgentLocalAudioAction.RunAsync(runtime.EnsureAudioAsync, () => {
                if (closing) return;
                ApplySelectedDevicesWithoutSaving();
                var listenLocally = localMonitoring?.Checked == true;
                runtime.StartMicrophoneTest(listenLocally);
                ShowFeedback(listenLocally
                    ? "Parlez normalement puis arrêtez le test : un court échantillon sera rejoué une fois, sans boucle d’écho ni fichier audio."
                    : "Parlez normalement : la jauge et le pourcentage doivent réagir. Aucun retour de voix, appel ou enregistrement n’est produit.", false);
            });
    });

    private Task PlayOutputTestAsync() => RunOperationAsync("Préparation du son de test local…", () =>
        AgentLocalAudioAction.RunAsync(runtime.EnsureAudioAsync, () => {
            if (closing) return;
            ApplySelectedDevicesWithoutSaving(); runtime.PlayOutputTest();
            ShowFeedback("Son de test envoyé uniquement vers la sortie sélectionnée.", false);
        }));

    private void ApplySelectedDevicesWithoutSaving()
    {
        var input = inputDevices?.SelectedItem as AudioDeviceItem;
        var output = outputDevices?.SelectedItem as AudioDeviceItem;
        if (input is null || output is null) throw new InvalidOperationException("AUDIO_DEVICE_UNAVAILABLE");
        runtime.ApplyDevices(input.Id, output.Id);
    }

    private async Task ConnectAsync()
    {
        if (closing || withdrawalBusy || runtime.WithdrawalPending) { ShowFeedback("Retrait en attente : connexion bloquée. Vérifiez uniquement le reçu.", true); return; }
        await RunOperationAsync("Connexion au CRM et au service téléphonique…", async () => {
            await runtime.StartAsync(); ShowFeedback("Connexion en cours. Le poste sera prêt lorsque les quatre contrôles seront confirmés.", false);
        });
    }

    private async Task DisconnectAsync()
    {
        if (closing || withdrawalBusy || runtime.WithdrawalPending) return;
        await RunOperationAsync("Déconnexion en cours… Votre profil et votre journal sont conservés.", async () => {
            await runtime.StopAsync();
            // Do not immediately recreate the SDK after the user explicitly
            // disconnected. Audio can be initialized by the Audio/Connect actions.
            ShowFeedback("Poste déconnecté. La configuration reste enregistrée.", false);
        });
    }

    private Task ReassociateAsync() => RunOperationAsync("Arrêt sûr du poste avant réassociation…", async () => {
        await runtime.StopForMaintenanceAsync();
        wizardVisible = true; wizardStep = 0; Render();
        ShowFeedback("Poste arrêté. Saisissez un nouveau code d’association ; le profil actuel reste conservé jusqu’à confirmation.", false);
    });

    private async Task RunOperationAsync(string message, Func<Task> operation)
    {
        if (operationBusy || closing || withdrawalBusy || runtime.WithdrawalPending) return;
        using var operationLease = operationGate.TryBegin();
        if (operationLease is null) return;
        ShowFeedback(message, false);
        contentHost.Enabled = false;
        UseWaitCursor = true;
        // Let Windows paint the progress state before any native operation.
        await Task.Yield();
        try {
            if (closing) return;
            operationTask = operation();
            await operationTask;
        }
        catch (Exception error) { ShowFeedback(HumanError(error), true); }
        finally {
            operationLease.Dispose();
            operationTask = null;
            if (!IsDisposed && !closing) { contentHost.Enabled = true; UseWaitCursor = false; UpdateVisibleState(); }
        }
    }

    private void FillDeviceCombos()
    {
        if (inputDevices is null || outputDevices is null) return;
        FillDevices(inputDevices, snapshot.Devices.Where(item => item.CanRecord), snapshot.InputDeviceId);
        FillDevices(outputDevices, snapshot.Devices.Where(item => item.CanPlay), snapshot.OutputDeviceId);
        if (inputDevices.Items.Count == 0 || outputDevices.Items.Count == 0) ShowFeedback("Aucun périphérique utilisable n’est disponible. Vérifiez le branchement et l’autorisation microphone de Windows.", true);
    }

    private void OnSnapshotChanged(AgentRuntimeSnapshot next)
    {
        if (closing || IsDisposed || Disposing) return;
        if (InvokeRequired) {
            try { if (IsHandleCreated) BeginInvoke(() => OnSnapshotChanged(next)); }
            catch (InvalidOperationException) when (closing || IsDisposed || Disposing || !IsHandleCreated) { }
            return;
        }
        var callJustEnded = AgentCallState.IsActive(snapshot.CallState) && !AgentCallState.IsActive(next.CallState);
        snapshot = next;
        UpdateVisibleState();
        if (callJustEnded && freeCallPhone is not null) {
            freeCallPhone.SelectAll();
            ShowFeedback("Appel terminé. La durée est figée et vous pouvez remplacer le numéro pour un nouvel appel.", false);
        }
    }

    private void UpdateVisibleState()
    {
        if (IsDisposed) return;
        if (crmStatus is not null) crmStatus.Text = snapshot.CrmConnected ? "Connecté" : snapshot.Running ? "Injoignable" : "Déconnecté";
        if (authorizationStatus is not null) authorizationStatus.Text = snapshot.AuthorizationState;
        if (sipStatus is not null) sipStatus.Text = snapshot.SipRegistered ? "Connecté" : snapshot.Running ? "Connexion en cours" : "Déconnecté";
        if (audioStatus is not null) audioStatus.Text = snapshot.InputDeviceAvailable && snapshot.OutputDeviceAvailable ? "Utilisable" : snapshot.AudioInitialized ? "À vérifier" : "Non chargé";
        var ready = AgentReadiness.IsReady(snapshot);
        if (readinessLabel is not null) { readinessLabel.Text = ready ? "Prêt à appeler" : ReadinessExplanation(snapshot); readinessLabel.ForeColor = ready ? Success : snapshot.Running ? Danger : Navy; }
        if (finishButton is not null) finishButton.Enabled = ready;
        if (connectButton is not null) connectButton.Enabled = !operationBusy && !snapshot.Running;
        if (disconnectButton is not null) disconnectButton.Enabled = !operationBusy && snapshot.Running;
        if (reassociateButton is not null) reassociateButton.Enabled = !operationBusy && !AgentCallState.IsActive(snapshot.CallState);
        var displayedMicrophoneLevel = snapshot.AudioTestActive ? snapshot.MicrophoneLevel : snapshot.LastMicrophonePeak;
        if (microphoneLevel is not null) microphoneLevel.Value = Math.Clamp(displayedMicrophoneLevel, 0, 100);
        if (microphoneLevelText is not null) microphoneLevelText.Text = snapshot.AudioMeterErrorCode is not null
            ? "Mesure interrompue · actualisez les périphériques puis réessayez."
            : snapshot.LocalMonitoringActive
                ? "Réécoute du court échantillon en cours…"
            : snapshot.AudioTestActive
                ? snapshot.MicrophoneLevel > 0 ? $"Signal détecté · {snapshot.MicrophoneLevel}%" : "Microphone ouvert · parlez normalement…"
                : snapshot.LastMicrophonePeak > 0 ? $"Pic du dernier test · {snapshot.LastMicrophonePeak}%" : "Lancez le test puis parlez normalement.";
        if (microphoneTestButton is not null) microphoneTestButton.Text = snapshot.LocalMonitoringActive ? "Arrêter la réécoute" : snapshot.AudioTestActive ? "Arrêter le test microphone" : "Tester le microphone";
        if (callValue is not null) callValue.Text = CallLabel(snapshot.CallState);
        if (durationValue is not null) durationValue.Text = snapshot.CallDurationSeconds is int seconds
            ? $"{(AgentCallState.IsActive(snapshot.CallState) ? "Durée en cours" : "Durée finale")} : {seconds / 60:00}:{seconds % 60:00}"
            : "Aucun appel actif";
        if (accountDisplayValue is not null) accountDisplayValue.Text = !string.IsNullOrWhiteSpace(snapshot.CrmDisplayName) ? snapshot.CrmDisplayName! : !string.IsNullOrWhiteSpace(snapshot.CrmEmail) ? snapshot.CrmEmail! : AccountLabel(setup.Settings);
        UpdateDeviceSummary();
        var mute = FindControl("mute") as Button; var hangup = FindControl("hangup") as Button;
        if (mute is not null) { mute.Text = snapshot.Muted ? "Rétablir le micro" : "Couper le micro"; mute.Enabled = snapshot.CallState == "ANSWERED"; }
        var callActive = AgentCallState.IsActive(snapshot.CallState);
        if (hangup is not null) hangup.Enabled = callActive;
        if (freeCallButton is not null) freeCallButton.Enabled = ready && !callActive;
        if (freeCallClearButton is not null) freeCallClearButton.Enabled = !callActive && freeCallPhone?.TextLength > 0;
        if (freeCallPhone is not null) freeCallPhone.ReadOnly = callActive;
        if (freeCallPurpose is not null) freeCallPurpose.Enabled = !callActive;
        if (freeCallComment is not null) freeCallComment.ReadOnly = callActive;
        if (inputDevices is not null && outputDevices is not null && inputDevices.Items.Count == 0 && snapshot.Devices.Count > 0) FillDeviceCombos();
    }

    private Control? FindControl(string name)
    {
        var controls = contentHost.Controls.Find(name, true);
        return controls.FirstOrDefault();
    }

    private void ExportDiagnostic()
    {
        using var dialog = new SaveFileDialog { Filter = "Diagnostic JSON (*.json)|*.json", FileName = $"crm-ynov-telephonie-{DateTime.Now:yyyyMMdd-HHmmss}.json", AddExtension = true, DefaultExt = "json" };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        var settings = store.Load(); DiagnosticsExporter.Export(dialog.FileName, snapshot, settings is not null, settings?.SipPassword.Length > 0);
        ShowFeedback("Diagnostic expurgé exporté.", false);
    }

    private async void OnFormClosing(object? sender, FormClosingEventArgs eventArgs)
    {
        if (closeCompleted) return;
        if (!allowClose && !withdrawalBusy && !runtime.WithdrawalPending && eventArgs.CloseReason == CloseReason.UserClosing) { eventArgs.Cancel = true; Hide(); tray.ShowBalloonTip(1500, "CRM Ynov", "L’agent reste accessible dans la zone de notification.", ToolTipIcon.Info); return; }
        eventArgs.Cancel = true;
        if (closing) return;
        closing = true; audioTimer.Stop(); contentHost.Enabled = false;
        try {
            if (operationTask is not null) { try { await operationTask; } catch { /* A failed stop never becomes an attestation. */ } }
            withdrawalCancellation?.Cancel();
            if (withdrawalTask is not null) { try { await withdrawalTask; } catch { /* Durable state stays pending. */ } }
            await protocolBroker.DisposeAsync(); await runtime.DisposeAsync();
            closeCompleted = true; tray.Visible = false; Close();
        } catch (Exception error) {
            closing = false; contentHost.Enabled = true; UseWaitCursor = false;
            // Keep audioTimer stopped after an unproven shutdown. Resuming it
            // would silently iterate/reinitialize an uncertain native runtime.
            ShowFeedback(HumanError(error), true);
        }
    }

    private ContextMenuStrip BuildTrayMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Ouvrir", null, (_, _) => RestoreWindow());
        menu.Items.Add("Connecter", null, async (_, _) => await ConnectAsync());
        menu.Items.Add("Déconnecter", null, async (_, _) => await DisconnectAsync());
        menu.Items.Add("Quitter", null, (_, _) => { allowClose = true; Close(); });
        menu.Opening += (_, _) => { var available = !closing && !operationBusy && !withdrawalBusy && !runtime.WithdrawalPending; menu.Items[1].Enabled = available; menu.Items[2].Enabled = available; };
        return menu;
    }

    private void RestoreWindow() { Show(); WindowState = FormWindowState.Normal; Activate(); }
    private void ShowFeedback(string message, bool error) { feedback.Text = message; feedback.ForeColor = error ? Danger : Success; }

    internal static string WithdrawalError(Exception error) => error switch {
        HttpRequestException { StatusCode: HttpStatusCode.NotFound } => "Le reçu n’est pas disponible. Le résultat reste incertain : profil et journal conservés, aucune nouvelle demande automatique.",
        OperationCanceledException => "La vérification a été interrompue ou a expiré. L’état durable reste conservé ; reprenez uniquement la consultation du reçu.",
        _ => HumanError(error),
    };

    internal static string HumanError(Exception error) => error switch {
        InvalidOperationException invalid when invalid.Message is "SDK_SHUTDOWN_TIMEOUT" or "SDK_SHUTDOWN_STATE_UNPROVEN" or "SDK_UNREGISTER_UNPROVEN" => "L’arrêt du service téléphonique n’a pas été confirmé dans le délai prévu. Profil et journal conservés. Aucune réassociation ni reconnexion automatique ; vérifiez l’état avant de réessayer.",
        InvalidOperationException invalid when invalid.Message == "WITHDRAWAL_SDK_STOP_UNPROVEN" => "L’arrêt sûr du SDK n’est pas prouvé. Aucun retrait envoyé. Ne reconnectez pas le poste pour fabriquer cette preuve ; faites vérifier l’état par le support.",
        InvalidOperationException invalid when invalid.Message == "PROFILE_WITHDRAWAL_LEGACY_ASSOCIATION" => "Cette association ancienne ne fournit pas la génération requise. Aucun profil supprimé ; utilisez le parcours officiel avec l’administration.",
        InvalidOperationException invalid when invalid.Message == "WITHDRAWAL_PROFILE_CHANGED" => "Le profil a changé depuis la demande. Retrait local refusé : configuration et reçu conservés pour vérification.",
        InvalidOperationException invalid when invalid.Message.StartsWith("WITHDRAWAL_", StringComparison.Ordinal) => "Un retrait reste à vérifier. Conservez le profil et le journal ; consultez le même reçu sans renvoyer la demande.",
        IOException io when io.Message.StartsWith("WITHDRAWAL_", StringComparison.Ordinal) => "L’état durable du retrait n’a pas pu être vérifié. Toute connexion est bloquée ; conservez les fichiers pour le support.",
        HttpRequestException { StatusCode: HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden } => "Le code ou l’autorisation du poste a été refusé. Demandez un nouveau code à l’administration.",
        HttpRequestException { StatusCode: HttpStatusCode.Conflict } => "Ce profil est déjà associé à un autre poste actif. L’administration doit d’abord vérifier cette association.",
        HttpRequestException http when http.StatusCode is HttpStatusCode.RequestTimeout or HttpStatusCode.TooManyRequests || (int?)http.StatusCode >= 500 => "Le résultat CRM est incertain. Ne répétez pas la demande ; faites rapprocher son reçu et conservez le journal local.",
        HttpRequestException http when http.StatusCode is not null => "Le CRM a refusé la demande. Vérifiez les informations saisies avant de recommencer.",
        HttpRequestException or TaskCanceledException or System.Text.Json.JsonException => "La réponse CRM n’a pas pu être confirmée. Ne répétez pas la demande ; la configuration et le journal locaux sont conservés pour vérification.",
        InvalidOperationException invalid when invalid.Message == "AGENT_NOT_PAIRED" => "Associez d’abord ce poste au CRM.",
        InvalidOperationException invalid when invalid.Message == "SIP_SECRET_MISSING" => "Enregistrez d’abord le mot de passe téléphonique sur ce poste.",
        InvalidOperationException invalid when invalid.Message == "SIP_SECRET_EMPTY" => "Le mot de passe téléphonique ne peut pas être vide.",
        InvalidOperationException invalid when invalid.Message == "PROFILE_MAINTENANCE_CALL_ACTIVE" => "Terminez l’appel avant de modifier ou réassocier le profil. L’appel en cours est conservé.",
        InvalidOperationException invalid when invalid.Message == "PROFILE_MAINTENANCE_PENDING_EVENTS" => "Attendez la confirmation des événements CRM avant de modifier le profil. Le journal est conservé.",
        InvalidOperationException invalid when invalid.Message == "PROFILE_MAINTENANCE_IN_PROGRESS" => "La configuration du profil est en cours. Reconnectez explicitement le poste une fois terminée.",
        InvalidOperationException invalid when invalid.Message == "PROFILE_MAINTENANCE_COMMAND_PENDING" => "Une commande CRM est en cours de vérification. Attendez son résultat avant de modifier le profil.",
        InvalidOperationException invalid when invalid.Message is "FREE_CALL_RESULT_UNCERTAIN" or "AGENT_COMMAND_INVALID" or "AGENT_COMMAND_MISSING" => "Le résultat d’une demande précédente reste incertain. La nouvelle demande est bloquée ; faites rapprocher le reçu par le support sans effacer le journal. La lecture du reçu seule ne débloque pas le poste.",
        InvalidOperationException invalid when invalid.Message == "CRM_ADDRESS_INVALID" => "L’adresse CRM doit être une URL complète, sans identifiant, paramètre ni fragment.",
        InvalidOperationException invalid when invalid.Message == "API_TLS_REQUIRED" => "Utilisez une adresse HTTPS. HTTP est autorisé uniquement pour une recette locale sur ce PC.",
        InvalidOperationException invalid when invalid.Message is "AUDIO_DEVICE_UNAVAILABLE" or "AUDIO_INPUT_UNAVAILABLE" or "AUDIO_OUTPUT_UNAVAILABLE" => "Le périphérique sélectionné n’est plus disponible. Actualisez la liste et choisissez un périphérique connecté.",
        InvalidOperationException invalid when invalid.Message == "AUDIO_NOT_INITIALIZED" => "Le service audio local n’est pas encore disponible. Rouvrez l’étape Audio.",
        InvalidOperationException invalid when invalid.Message == "AUDIO_TEST_CALL_ACTIVE" => "Terminez l’appel en cours avant de lancer un test audio local.",
        InvalidOperationException invalid when invalid.Message == "AUDIO_TEST_ACTIVE" => "Arrêtez le test microphone avant de lancer un appel ou un autre test audio.",
        InvalidOperationException invalid when invalid.Message is "AGENT_NOT_READY" or "AGENT_NOT_CONNECTED" => "Connectez le poste et attendez les quatre contrôles avant de lancer l’appel.",
        InvalidOperationException invalid when invalid.Message.StartsWith("AUDIO_PLAYBACK", StringComparison.Ordinal) => "Le court échantillon n’a pas pu être rejoué sur cette sortie. Décochez l’option pour tester uniquement la jauge, puis vérifiez la sortie séparément.",
        InvalidOperationException invalid when invalid.Message == "AUDIO_MICROPHONE_OPEN_FAILED" => "Le microphone n’a pas pu être ouvert. Vérifiez qu’il est connecté et que Windows autorise l’accès au microphone.",
        InvalidOperationException invalid when invalid.Message == "AUDIO_CAPTURE_RESTART_REQUIRED" => "Windows n’a pas libéré le microphone en toute sécurité. Quittez puis relancez l’agent avant un nouvel essai ou appel.",
        InvalidOperationException invalid when invalid.Message.StartsWith("AUDIO_CAPTURE_", StringComparison.Ordinal) => "Le niveau du microphone ne peut pas être mesuré sur ce périphérique. Actualisez la liste, sélectionnez explicitement le micro puis réessayez.",
        InvalidOperationException invalid when invalid.Message is "AUDIO_PLAYER_UNAVAILABLE" or "AUDIO_TEST_FILE_MISSING" => "Le son de test n’a pas pu être envoyé vers la sortie choisie. Actualisez les périphériques puis réessayez.",
        _ => "L’opération n’a pas pu être confirmée. Vérifiez l’état du poste et du CRM avant toute nouvelle action ; aucun résultat téléphonique n’est déduit de cette erreur.",
    };

    private static string ReadinessExplanation(AgentRuntimeSnapshot state)
    {
        if (!state.Running) return "Poste déconnecté · profil conservé";
        if (!state.InputDeviceAvailable || !state.OutputDeviceAvailable) return "Périphériques audio à vérifier";
        if (!state.CrmConnected) return "Connexion CRM à confirmer";
        if (state.AuthorizationState != "Autorisée") return "Autorisation du poste à confirmer";
        if (!state.SipRegistered) return "Connexion téléphonique à confirmer";
        return "Disponibilité à confirmer";
    }

    private static string AccountLabel(AgentSettings? settings)
    {
        if (!string.IsNullOrWhiteSpace(settings?.CrmDisplayName)) return settings.CrmDisplayName!;
        if (!string.IsNullOrWhiteSpace(settings?.CrmEmail)) return settings.CrmEmail!;
        return settings is null ? "Non associé" : "Compte CRM associé";
    }

    private string DeviceLabel(string? id, bool input)
    {
        if (string.IsNullOrWhiteSpace(id)) return "Non sélectionné";
        return snapshot.Devices.FirstOrDefault(item => item.Id == id && (input ? item.CanRecord : item.CanPlay))?.Name ?? "Périphérique actuellement déconnecté";
    }

    private void UpdateDeviceSummary()
    {
        // Labels created before audio initialization must follow the exact
        // current snapshot. No implicit device choice or reconnection occurs.
        if (microphoneDisplayValue is not null) microphoneDisplayValue.Text = DeviceLabel(snapshot.InputDeviceId, true);
        if (outputDisplayValue is not null) outputDisplayValue.Text = DeviceLabel(snapshot.OutputDeviceId, false);
    }

    private static string CallLabel(string? state) => state switch { "DIALING" => "Numérotation demandée", "RINGING" => "Le poste distant sonne", "ANSWERED" => "Communication établie", "ENDED" => "Appel terminé", "FAILED" => "Échec de l’appel", "MISSED" => "Sans réponse", "CANCELLED" => "Appel annulé", _ => "Aucun appel en cours" };
    private static string MaskSip(string value) { var at = value.IndexOf('@'); var user = value.StartsWith("sip:", StringComparison.OrdinalIgnoreCase) ? value[4..Math.Max(4, at)] : "Extension"; return at < 0 ? "Extension configurée" : $"{user} · {value[(at + 1)..]}"; }

    private static TableLayoutPanel Page() => new ResponsiveStack { Padding = new Padding(24), BackColor = Surface };
    private static Panel Card() => new() { Dock = DockStyle.Top, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, BackColor = Color.White, Padding = new Padding(20), BorderStyle = BorderStyle.None };
    private static Label StatusValue() => new() { AutoSize = true, Font = new Font("Segoe UI", 10, FontStyle.Bold), ForeColor = Navy };
    private static Control BuildBrandHeader(string title, string subtitle)
    {
        var panel = new ResponsiveStack { Margin = new Padding(0, 0, 0, 24) };
        panel.Controls.Add(new Label { AutoSize = true, Text = "RELATION YNOV", Font = new Font("Segoe UI", 8, FontStyle.Bold), ForeColor = Teal });
        panel.Controls.Add(new Label { AutoSize = true, Text = title, Font = new Font("Segoe UI", 23, FontStyle.Bold), ForeColor = Navy });
        panel.Controls.Add(new Label { AutoSize = true, Text = subtitle, ForeColor = Muted, MaximumSize = new Size(800, 0) });
        return panel;
    }
    private static Control StatusCard(string label, Control value) { var panel = Card(); panel.Padding = new Padding(14); panel.Margin = new Padding(0, 0, 8, 0); panel.MinimumSize = Size.Empty; var stack = FormStack(); stack.Controls.Add(new Label { AutoSize = true, Text = label, Font = new Font("Segoe UI", 8, FontStyle.Bold), ForeColor = Teal }); stack.Controls.Add(value); panel.Controls.Add(stack); return panel; }
    private static TabPage Tab(string title, Control content) { var page = new TabPage(title) { BackColor = Surface, Padding = new Padding(18), AutoScroll = true }; page.Controls.Add(content); return page; }
    private static TableLayoutPanel FormStack() => new ResponsiveStack { Padding = new Padding(2) };
    private static FlowLayoutPanel ButtonRow() => new() { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, FlowDirection = FlowDirection.LeftToRight, WrapContents = true, Margin = new Padding(0, 14, 0, 0), Padding = new Padding(0, 0, 0, 4) };
    private static Control SectionTitle(string title, string description) { var panel = FormStack(); panel.Margin = new Padding(0, 0, 0, 16); panel.Controls.Add(new Label { AutoSize = true, Text = title, Font = new Font("Segoe UI", 15, FontStyle.Bold), ForeColor = Navy }); panel.Controls.Add(new Label { AutoSize = true, MaximumSize = new Size(720, 0), Text = description, ForeColor = Muted }); return panel; }
    private static Control Labeled(string label, Control control) { control.Width = 520; var panel = FormStack(); panel.Margin = new Padding(0, 0, 0, 12); panel.Controls.Add(new Label { AutoSize = true, Text = label, Font = new Font("Segoe UI", 9, FontStyle.Bold), ForeColor = Navy }); panel.Controls.Add(control); return panel; }
    private static Control SummaryRow(string label, string value) { var panel = new TableLayoutPanel { AutoSize = true, Width = 690, ColumnCount = 2, Margin = new Padding(0, 0, 0, 8) }; panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 200)); panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); panel.Controls.Add(new Label { AutoSize = true, Text = label, ForeColor = Muted }, 0, 0); panel.Controls.Add(new Label { AutoSize = true, Text = value, Font = new Font("Segoe UI", 9.5f, FontStyle.Bold), ForeColor = Navy, MaximumSize = new Size(470, 0) }, 1, 0); return panel; }
    private static Control SummaryRow(string label, Control value) { var panel = new TableLayoutPanel { AutoSize = true, Width = 690, ColumnCount = 2, Margin = new Padding(0, 0, 0, 8) }; panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 200)); panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); panel.Controls.Add(new Label { AutoSize = true, Text = label, ForeColor = Muted }, 0, 0); panel.Controls.Add(value, 1, 0); return panel; }
    private static Label SummaryValue(string value) => new() { AutoSize = true, Text = value, Font = new Font("Segoe UI", 9.5f, FontStyle.Bold), ForeColor = Navy, MaximumSize = new Size(470, 0) };
    private static Control InfoBox(string title, string value) { var panel = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, BackColor = Color.FromArgb(232, 248, 246), Padding = new Padding(14), Margin = new Padding(0, 0, 0, 14), MaximumSize = new Size(720, 0) }; panel.Controls.Add(new Label { AutoSize = true, Text = title, Font = new Font("Segoe UI", 9, FontStyle.Bold), ForeColor = Success }); panel.Controls.Add(new Label { AutoSize = true, Text = value, ForeColor = Navy, MaximumSize = new Size(680, 0) }); return panel; }
    private static TextBox Field(string value) => new() { Text = value, Width = 520, BorderStyle = BorderStyle.FixedSingle };
    private static ComboBox DeviceCombo() => new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 520 };
    private static Button ActionButton(string text, bool primary) { var button = new Button { AutoSize = true, Text = text, FlatStyle = FlatStyle.Flat, Padding = new Padding(13, 7, 13, 7), Margin = new Padding(0, 0, 8, 8), BackColor = primary ? Teal : Color.White, ForeColor = primary ? Navy : Navy, Font = new Font("Segoe UI", 9.5f, FontStyle.Bold), UseVisualStyleBackColor = false }; button.FlatAppearance.BorderColor = primary ? Teal : Color.FromArgb(188, 202, 213); return button; }

    // A vertical FlowLayoutPanel does not stretch children, even with Dock=Top.
    // One percent-width table column gives every card its real available width
    // before measuring wrapped text/actions and their preferred heights.
    private sealed class ResponsiveStack : TableLayoutPanel
    {
        public ResponsiveStack()
        {
            Dock = DockStyle.Top; AutoSize = true; AutoSizeMode = AutoSizeMode.GrowAndShrink;
            ColumnCount = 1; ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            GrowStyle = TableLayoutPanelGrowStyle.AddRows;
            DoubleBuffered = true;
        }
        protected override void OnLayout(LayoutEventArgs levent)
        {
            var available = Math.Max(1, ClientSize.Width - Padding.Horizontal);
            foreach (Control child in Controls) {
                var width = Math.Max(1, available - child.Margin.Horizontal);
                if (child is Label label) {
                    if (label.MaximumSize.Width != width) label.MaximumSize = new Size(width, 0);
                } else if (child is not Button) { child.Dock = DockStyle.Top; if (child.Width != width) child.Width = width; }
            }
            base.OnLayout(levent);
        }
    }
    private static void FillDevices(ComboBox combo, IEnumerable<AudioDeviceView> devices, string? selectedId) { combo.Items.Clear(); foreach (var item in devices) combo.Items.Add(new AudioDeviceItem(item.Id, item.Name)); var selected = combo.Items.Cast<AudioDeviceItem>().FirstOrDefault(item => item.Id == selectedId); combo.SelectedItem = selected ?? (combo.Items.Count > 0 ? combo.Items[0] : null); }
    private sealed record AudioDeviceItem(string Id, string Label) { public override string ToString() => Label; }
    private sealed record DestinationTypeItem(string Code, string Label) { public override string ToString() => Label; }
    private sealed record PurposeItem(string Code, string Label) { public override string ToString() => Label; }
}
