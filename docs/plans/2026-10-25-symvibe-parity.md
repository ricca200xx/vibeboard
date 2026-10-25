# vibeboard: confronto con Symvibe e piano delle feature

Data: 25 ottobre 2026. Fonte: i 18 video in `goal of progect/` (video marketing di Symvibe).
Metodo: osservazione dei frame (≈430, presi a ogni cambio di scena), confrontati con il codice di
`main` (`5e61ff5`). Solo comportamento visibile: nessun codice o asset di Symvibe viene copiato.

Legenda: ✅ c'è già · 🟡 c'è, da migliorare · ❌ manca · ➕ ce l'ha solo vibeboard.
Taglia: **S** mezza giornata · **M** 1–2 giorni · **L** 3+ giorni.

---

## 1. Riepilogo

| Area | Stato | Cosa manca, in una riga |
|---|---|---|
| Board, zoom, workspace, top bar | ✅ | dettagli: pill usage con orario di reset |
| Console (PTY, stato, resume, account) | ✅ | badge già presenti; resume per-console già fatto |
| Gruppi + composer di gruppo + preset | ✅ | animazione dei segnaposto allo spawn |
| **Orchestrator come nodo** | ❌ | nodo sulla board che "collega" gruppi/console e li comanda |
| Mission Map | 🟡 | Pause/Kill, "da quanto", pannello Fleet/Structure, colonna orchestrator |
| Command bar + voce | ✅ | chip di suggerimento ("Try 'pass this task to codex'"), "Found a bug?" |
| Loops | 🟡 | template, countdown, run-now, on/off, "keep running behind other tabs" |
| Memory | 🟡 | scelta CLI, avanzamento live, revisione proposte, card memoria sulla board |
| Git | 🟡 | checkbox per file, +/− righe, "Commit & Push" unico, commit recenti |
| Account | 🟡 | "Use" (default per le nuove console), "Connect" con login nel terminale |
| Usage | 🟡 | limiti reali del piano (sessione/settimana), token per agente, Codex |
| Note, testo, penna | 🟡 | inspector (colori, font, dimensioni, opacità, livelli), penna a colori/spessori |
| Forme e frecce | ❌ | rettangoli/ellissi stile "a mano", testo dentro, frecce |
| Kanban | 🟡 | colonne libere, dialog card (note, scadenza, priorità), drag tra colonne |
| Calendario, Checklist | ❌ | due nodi nuovi |
| Web tile | 🟡 | tab, porte localhost rilevate, link rapidi; inspector e siti esterni solo da app nativa |
| Studio Code | ❌ | albero file + editor + "Insert" del file sulla board |
| Studio Documents | ❌ | documenti generati dalla CLI, stream live, libreria, Export PDF |
| Studio Markdown | ❌ | vault dei .md: Reading / Source / Graph |
| Studio Diagrammi | ❌ | "Claude is drawing": mappa dei componenti disegnata sulla board |
| App nativa | ❌ | finestra macOS; prerequisito per web tile completo e inspector |

**Solo nostro (➕), da tenere:** hand-off con filo console→console, lead che chiama helper via MCP,
notifiche di sistema "Needs you", 19 CLI + shell, template di team, invio prompt dalla Mission Map,
pannello git con messaggio scritto da Claude, due account della stessa CLI.

---

## 2. Dettaglio per area

### 2.1 Board e top bar — ✅
Symvibe: Back to home · progetto ▾ · tab workspace con badge e × · + · Close; a destra "N live",
pill usage "resets 4:09am", valigetta, impostazioni, avatar. Rail sinistro (select, spawn, forme,
console, testo, penna, gomma, web, immagine, fit) e rail destro (mission map, kanban, orchestrator,
code, documents, markdown, loops con badge). Zoom in basso a destra, branch git in basso a sinistra.

vibeboard ha tutto tranne:
- 🟡 **pill usage con orario di reset** (oggi apre il pannello token): dipende da 2.9. **S**
- 🟡 **badge sul rail loops** con il numero di loop attivi. **S**
- ❌ **"Found a bug?"** in basso a destra: link a GitHub Issues precompilato. **S**

### 2.2 Console — ✅
Header con icona agente, nome, stato READY/WORKING/RUNNING, restart, duplica, chiudi: c'è.
Badge YOLO, lead e account: ci sono. Resume (toast "Resume all conversations?" + chip per console
"Resume last conversation? · typing starts fresh"): c'è.
- 🟡 Icona "focus" nell'header (zoom sulla console a schermo intero). **S**

### 2.3 Gruppi, composer, preset — ✅
Composer: nome, chip di ruolo colorati (Frontend, Backend, Testers, Reviewers, Design, Docs,
Security, General), griglia di slot cliccabili per cambiare agente, "Fill all", − N + (max 12),
"Spawn N": c'è (`BottomBar.tsx`, `Composer`).
- 🟡 Allo spawn Symvibe disegna subito la cornice del gruppo con N segnaposto vuoti che si
  riempiono uno alla volta: più leggibile per un non tecnico. **S**
- 🟡 Chevron ▾ nell'header del gruppo (menu: rinomina, colore, chiudi tutti, collassa). **S**

### 2.4 Orchestrator come nodo — ❌ (la differenza più grande)
Cosa fa in Symvibe (video `board`, `voice`):
1. Dal rail (icona spark) si posa un nodo **Orchestrator** sulla board.
2. Vuoto: "No agents wired — Spawn a fresh lane below, or tap Connect and pick consoles or groups
   on the board" + "Spawn agent" + composer proprio ("Try 'spawn two reviewers'…").
3. **Connect**: le console sulla board diventano tratteggiate; clic su console o gruppi (o sulla
   lista GROUPS/CONSOLES nel nodo) per collegarli; "Done". Partono fili curvi dal nodo a ogni
   gruppo/console collegato.
4. Collegato: "21 agents · 3 groups", lista per team con stato (idle/running) e avanzamento
   "0/8" per team e "0/21" in alto (anello).
5. Composer "Command 21 agents · @ to direct…": un'istruzione in linguaggio naturale va a tutti
   gli agenti collegati (o solo a quelli citati con @).

Cosa abbiamo già da riusare: planner (`planner.ts`), invio a `@Gruppo`, fili custom
(`HandoffEdge.tsx`), lead + helper via MCP (`server/helpers.mjs`), stato per console.

Da costruire:
- Nodo `orchestrator` con `data.wired: string[]` (id di gruppi e console) e fili di tipo `command`. **M**
- Modalità Connect: clic su nodi della board per aggiungere/togliere dal cablaggio. **S**
- Lista agenti con stato + contatori done/total per team (dai dati di stato che abbiamo). **S**
- Composer del nodo: testo libero → planner ristretto agli agenti collegati; "spawn N reviewers"
  crea console già collegate. **M**
- Mission Map: colonna Orchestrator → Team → console; le console senza orchestrator finiscono
  in "Command center" con linea tratteggiata. **S**

Scelta da fare (vedi §4): l'orchestrator è solo un "telecomando" (planner + broadcast) o è un
Claude vero che ragiona e delega (come il nostro lead)? La mia proposta: telecomando prima, con
un interruttore "lead" che lo rende un Claude con i tool MCP che abbiamo già.

### 2.5 Mission Map — 🟡
Abbiamo: filtri All/Working/Needs you/Idle/Done, ricerca, albero team→console, "Frame the team",
dettaglio console con "Jump there" e invio prompt (➕).
Mancano:
- Pannello di default **Fleet** (conteggi per stato) + **Structure** (orchestrator, team, console,
  loop attivi). **S**
- Dettaglio console: **Pause**, **Kill**, **"For 54m 21s"** (da quanto è in quello stato),
  **Belongs to** (team / orchestrator / "Command center"). **S**
- Doppio clic su una card = salta lì; legenda in basso. **S**

### 2.6 Command bar e voce — ✅
"Hold space to speak · @ to direct", stato listening con stop, "Thinking"/"Planning…", cronologia
con ^: ci sono.
- 🟡 Chip di suggerimento sopra le azioni ("Try 'pass this task to codex'" con ×) e l'intento
  "passa questo compito a X" nel planner (= hand-off al volo). **S**
- Nota: la dettatura usa la Web Speech API del browser; nell'app nativa servirà lo speech di macOS.

### 2.7 Loops — 🟡
Form identico al nostro (quando: schedule / idle / output contiene; target: tutte / scelte;
stop: n run, tempo, goal con comando o agente giudice; stima "≈ 4 prompts/h").
Mancano:
- **Template** (Progress check, Keep them moving, Build rescue, Test watchdog, Commit checkpoint,
  Review sweep, Hourly…): riempiono nome + istruzione. **S**
- Campo **nome** (opzionale, dedotto dall'istruzione). **S**
- Riga lista: nome, "Every 15 min · All consoles · until Claude calls it met", **countdown
  "in 14:58"**, **▶ run now**, **interruttore on/off**, menu "…". Oggi c'è solo elimina. **S**
- Opzione **"Keep running behind other tabs"** (se spenta, il loop si mette in pausa quando il
  workspace non è visibile e recupera al ritorno). **S**

### 2.8 Memory — 🟡
Abbiamo: scan del repo, scrittura manuale, toggle attivo, push alle console, tab repo / All repos.
Mancano:
- Scelta della CLI per lo scan (Claude, Codex, Gemini, Grok, OpenCode). **S**
- **Avanzamento live**: Launch → Read the repo → Write facts → Wrap up, timer, "N facts", i fatti
  compaiono mentre arrivano; il pannello si può chiudere e lo scan continua. **M**
- **Revisione proposte**: niente viene salvato finché non accetti ("12 of 12 selected", modifica
  per riga, "Add 12 to memory" / Discard). **S**
- Categorie in più: Context, Architecture. **S**
- **"Place card on board"**: nodo memoria collegato con fili alle console, pulsante Push. **M**

### 2.9 Usage — 🟡
Abbiamo: heatmap dei token di Claude dai log locali, streak, giorni attivi.
Symvibe mostra in più:
- **Limiti reali del piano**: sessione corrente % + orario di reset, settimana (tutti i modelli) %,
  settimana per modello %. Li legge dal comando `/usage` della CLI ("claude › /usage"). **M**
- Tab per agente (Claude, Codex, Gemini…), statistiche (modello preferito, sessioni, giorno più
  attivo, sessione più lunga). **S**
- **Ultime 24h**: % del tempo sopra 150k di contesto, % con 4+ sessioni in parallelo, con consiglio. **S**
- Vista **tokens**: barre per giorno degli ultimi 30 giorni per agente (All / In+out / Output),
  totale per agente con in/out/cache, anche Codex (dai suoi log di sessione). **M**

### 2.10 Git — 🟡
Abbiamo: lista file cambiati, nota scritta da Claude dal diff, snapshot (commit), push, pull ff-only.
Mancano:
- Header: nome repo (owner/repo), "main · synced", icone storia, apri su GitHub, refresh. **S**
- **Checkbox per file** (scegli cosa salvare), "None"/"All", **+N −M righe**. **S**
- Pulsante unico **"Commit & Push N files"** (oggi due passi). **S**
- **RECENT**: ultimi commit con tempo relativo; stato vuoto "Working tree clean". **S**

### 2.11 Account — 🟡
Abbiamo: profili per CLI in Settings, scelta del profilo dal menu agente della console.
Symvibe (dal pill usage → "accounts"):
- Tab per agente; riga "Your sign-in · ACTIVE"; per profilo **Use** (diventa il default delle
  nuove console), apri console, rinomina, elimina. **S**
- **"Connect another account"**: nome → posa una console che fa il login nel terminale. **S**
- **"Save your current sign-in as a profile"**. **M** (va capito cosa copiare senza toccare segreti)
- Avviso Keychain: su macOS Claude può tenere il login nel Portachiavi, quindi i profili non sono
  isolati al 100%; verificare con `/status`. Da mostrare anche da noi. **S**

### 2.12 Note, testo, penna, forme, immagini — 🟡 / ❌
- 🟡 **Inspector flottante** quando selezioni un elemento:
  - nota: 8 colori + personalizzato, porta avanti/indietro, duplica, elimina. **S**
  - testo: colore, 8 font (anche calligrafico), S/M/L/XL, allineamento, opacità, livelli. **M**
- 🟡 Nota con aspetto "carta" (angolo piegato, font a mano). **S**
- 🟡 **Penna** (video `node-ink`): pannello COLOR con 8 colori + personalizzato e WIDTH con 5
  spessori; i tratti sono liberi e passano sopra immagini e board (cerchi, frecce, scritte a mano). **S**
- ❌ **Forme** (rettangolo, ellisse, cornice tratteggiata) stile disegnato a mano, con testo dentro,
  e **frecce** con etichetta. **M**
  (serve anche agli Studio Diagrammi, §2.17)
- ❌ **Annotare le immagini** a penna (video `node-ink`): il tratto sopra un'immagine resta sopra
  di lei. **S** dopo la penna.

### 2.13 Kanban — 🟡
Oggi: 3 colonne fisse, card di solo testo, freccia "sposta".
Symvibe: Backlog / To do / In progress / Done con contatori, menu "…" per colonna, "+ Column";
dialog **New card** (titolo, note, scadenza Today/Tomorrow/Next week/data, priorità
None/Low/Med/High); card con cerchio di completamento, barra colorata, chip data e priorità;
**drag** tra colonne. **M**

### 2.14 Calendario e Checklist — ❌
- **Calendar**: vista mese, "+ New", Today, ↑↓; evento con titolo, data, giornata intera, 6 colori,
  note; drag tra i giorni. **M**
- **Checklist** ("objectives"): lista di obiettivi spuntabili, "+ Add an objective". **S**

### 2.15 Web tile — 🟡
Oggi: iframe con barra URL, reload, apri nel browser. Limite: molti siti esterni rifiutano l'iframe.
Symvibe:
- Pagina iniziale "Open a page": **porte localhost rilevate** (":3000 :5173 :8080…" con pallino
  verde se in ascolto), link rapidi (Google, GitHub, MDN, npm…). **S**: il server legge le porte
  in ascolto con `lsof`.
- Tab dentro il tile, avanti/indietro, chip dimensione viewport. **S**
- **Inspector** (Web Inspector di WebKit, nodo separato collegato al tile) e siti esterni senza
  limiti: **solo con l'app nativa** (WKWebView o webview di Electron). **L**, dipende da §2.20.

### 2.16 Studio Code — ❌ (**L**)
- Modale "Code · <repo>": albero dei file (cartelle espandibili, icone per tipo), "+" nuovo file,
  "Add folder" (aprire un'altra cartella).
- Editor: breadcrumb, chip lingua, "27 lines · 805 B", numeri di riga, evidenziazione, stato
  Edited/Saved, Save.
- **Insert**: posa il file sulla board come **nodo codice** (sola lettura, evidenziato, scrollabile).
- Server: API lista/lettura/scrittura file **limitate alla cartella del progetto** (controllo
  path traversal, come per i profili). Editor: CodeMirror 6 (unica dipendenza nuova sensata).

### 2.17 Studio Documents — ❌ (**L**)
- "Generate a PDF from your repo — with your CLI": scelta CLI, profondità Quick / Balanced /
  Thorough (con tempo stimato dall'ultima volta).
- Template: Project overview, Onboarding guide, Architecture, README, API reference, Data model,
  Security overview, più "Ask for anything" libero.
- Generazione con stato live (Thinking → Writing → Finishing · 48s), **Stop**, il documento appare
  mentre viene scritto, stile "carta" con callout NOTE/TIP.
- Finito: parole e minuti di lettura, rigenera, copia, **posa sulla board** (nodo documento),
  **Export PDF**; salvato nella libreria del repo (pallino verde sui template già fatti).
- Come: `claude -p` con output in streaming, markdown renderizzato; PDF dalla stampa con CSS
  dedicato (nell'app nativa: export PDF della webview).

### 2.18 Studio Markdown — ❌ (**M**)
Dal video `studio-markdown`:
- Modale "Markdown · <repo>" con "Search files" e albero di tutti i .md (cartelle annidate, es.
  `docs/00-overview/01-what-is-…`), "+" nuova nota.
- Lettore: breadcrumb `docs › 07-s… › 01-th…`, "972 words · ~4 min", tipografia curata (titoli
  sottolineati, tabelle, codice inline evidenziato).
- Viste **Reading / Source / Graph**: Graph = "Link graph · 88 notes", grafo a forza di tutte le
  note e dei loro link, si apre una nota cliccandola.
- **Add to Board**: la nota diventa un nodo sulla board (titolo file, contenuto scrollabile).
  **Export PDF**.
Riusa renderer e PDF di §2.17; il grafo si fa con React Flow che abbiamo già.

### 2.19 Studio Diagrammi — ❌ (**M**, dopo le forme)
Dal video `studio-diagrams`:
- Banner "Claude is drawing ×"; la mappa compare a pezzi: prima box vuoti e frecce, poi le etichette.
- Risultato: titolo ("Votelanding Component Map"), cornici tratteggiate per area (CLIENT, RUNTIME,
  APP), ellissi e box arrotondati con titolo + sottotitolo (`next.config.ts · build config`),
  frecce con etichetta (configures, renders, serves, imports, reads, submits), font monospace a mano.
- Sono forme vere della board: doppio clic modifica il testo, inspector testo (§2.12), si spostano.
Come: Claude restituisce un JSON di box, gruppi e frecce; noi lo trasformiamo in forme e frecce
(§2.12) e li posiamo uno alla volta per l'effetto "sta disegnando".

### 2.20 App nativa macOS — ❌ (**L**)
Symvibe è un'app nativa: finestra vera, Web Inspector di WebKit, webview senza limiti iframe.
Sblocca: web tile completo + inspector (§2.15), speech nativo, notifiche native, PDF nativo.
La scelta della shell (Electron / Tauri / SwiftUI) resta da fare (già in roadmap, punto 2).

---

## 3. Ordine proposto

| Fase | Contenuto | Taglia | Perché adesso |
|---|---|---|---|
| **1. Orchestrazione** | Orchestrator come nodo (§2.4), Mission Map completa (§2.5), chip di suggerimento + "passa a X" (§2.6), segnaposto allo spawn (§2.3) | L | è il cuore del prodotto e l'obiettivo "agenti e sotto-agenti intuitivi" |
| **2. Rifiniture rapide** | Loops (§2.7), Git (§2.10), Account (§2.11), Memory con revisione (§2.8) | M | tutte S, rendono le feature che già esistono al livello di Symvibe |
| **3. Lavagna** | inspector note/testo, penna a colori, forme e frecce, annotare immagini (§2.12), Kanban (§2.13), Calendar e Checklist (§2.14) | L | prerequisito degli Studio Diagrammi |
| **4. Studios** | Documents → Markdown → Code → Diagrammi (§2.16–2.19) | L | è già il punto 1 della roadmap nel README |
| **5. Usage vero** | limiti del piano, token per agente, insight 24h (§2.9), pill con reset (§2.1) | M | utile ma non blocca nulla |
| **6. App nativa** | shell macOS, web tile completo + inspector (§2.15, §2.20), poi Liquid Glass | L | roadmap punti 2–3 |

Ogni fase: design breve → piano → implementazione nel worktree → test (`npm test`, `tsc`) →
prova su istanza isolata → commit sul branch `mvp`.

---

## 4. Decisioni per Ricky

1. **Orchestrator**: solo telecomando (planner + invio ai collegati) o un Claude vero che delega?
   Proposta: telecomando, con un interruttore "lead" per renderlo un Claude con i nostri tool MCP.
2. **Ordine**: partire dalla fase 1 (orchestrazione) o dalla fase 2 (rifiniture rapide)?
3. **Studios**: quale per primo? Proposta: Documents, perché Markdown e Diagrammi riusano il suo
   renderer.
4. **Usage reale**: va bene lanciare `/usage` della CLI in una console nascosta per leggere i limiti
   del piano?
5. **App nativa**: Electron (riuso totale, pesante), Tauri (leggera, PTY da riscrivere o sidecar
   Node) o SwiftUI (più Apple, riscrittura del canvas)? Decide anche quando arriva il web tile completo.
