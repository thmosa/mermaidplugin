# Utredning: förbättrat Mermaid-tillägg för VS Code

*2026-10-26 · Fokus: layout/utseende, redigering och ett arbetsträd för att dölja delar av diagrammet*

## 1. Kort slutsats

Förhandsvisning, export och teman finns redan i flera tillägg. Det som saknas är ett
**arbetsträd (outline) över diagrammets delar där man kan bocka av noder, kanter och
subgrafer för att dölja dem i renderingen**. Jag hittade inget befintligt tillägg som gör
det, varken för VS Code eller Obsidian. Det blir tilläggets huvudfunktion. Layout- och
utseendekontroller ingår som stöd.

## 2. Vad som redan finns

| Lösning | Styrkor | Brister för oss |
|---|---|---|
| **Inbyggt i VS Code** (enligt en källa från v1.121, maj 2026, före detta `bierner.markdown-mermaid`) | Mermaid i Markdown-preview, pan/zoom | Bara visning. Ingen struktur, inget döljande. *Påståendet är overifierat, kontrollera i din version.* |
| **Mermaid Chart** (`vscode-mermaid-chart`, MIT, v2.8.x, Mermaid 12.1) | Live-preview, teman, SVG/PNG-export, felmarkering, AI-förslag på layout | Kräver konto sedan v2.7.7. Visuell redigering sker på webben. Inget döljande. |
| **Mermaid Preview** (samma organisation) | Gratis preview och export, inget konto | Bara visning |
| **Merlay** (Obsidian + VS Code) | Visuell redigering: lägg till noder, dra kopplingar, byt namn inline | Ingen outline och inget döljande. Fri placering av noder verkar saknas. |
| **mermaid-viewer** | Egna teman, export, fokuserad preview | Bara visning |

## 3. Vad Mermaid 12 ger oss för layout och utseende

Mermaid 12 ändrade mycket på det här området, och det kan ett tillägg exponera direkt:

- **`layout`**: ELK är nu standard för flowchart, state, class, ER m.fl. Varianter:
  `elk.stress`, `elk.force`, `elk.mrtree`, `elk.box`, `elk.rectpacking` m.fl. `dagre` ger den gamla stilen.
  ELK-inställningar: `nodePlacementStrategy`, `mergeEdges`, `considerModelOrder`.
- **`look`**: `neo` (ny standard), `classic`, `handDrawn` (+ `handDrawnSeed` för stabil rendering).
- **`theme`**: nya `redux-color` / `redux-dark-color` med färg per subgraf/klass, plus de klassiska.
- Inställningarna kan sättas **per diagramtyp** och per diagram via frontmatter.

**Idé:** en verktygsrad i preview med rullgardiner för layout, look och tema. Valet skrivs
som frontmatter (`config: { layout: elk, look: neo }`) i källan, så diagrammet ser likadant
ut överallt, även på GitHub och i andra verktyg.

## 4. Huvudfunktionen: arbetsträd med döljning

### Så ska det fungera

```
MERMAID-STRUKTUR                     ┌──────── Preview ────────┐
☑ ▾ Subgraf: Backend                 │                         │
☑     API-gateway                    │   [API] ──▶ [Auth]      │
☐     Loggtjänst        ← dold       │     │                   │
☑     Auth                           │     ▼                   │
☑ ▸ Subgraf: Frontend (hopfälld)     │   [Frontend ▣]          │
☐ ▾ Kanter                           │                         │
☐     API → Logg        ← dold       └─────────────────────────┘
```

- **Kryssruta** på varje nod, kant och subgraf: döljer elementet i renderingen.
- **Fäll ihop subgraf**: subgrafen ritas som en enda platshållarnod, och kanterna dras om till den.
- **Klick i trädet**: markerar elementet i preview och hoppar till raden i editorn. Det fungerar åt båda hållen.
- **Snabbval**: "Visa bara detta + grannar", "Dölj alla kanter", "Visa allt".
- **Filter/sök** i trädet.

### Tre tekniska strategier för att dölja

| Strategi | Hur | För | Emot |
|---|---|---|---|
| **A. Filtrera källtext** (rekommenderas som standard) | Bygg en filtrerad kopia av diagramtexten utan dolda element och rendera den. Filen ändras inte. | Layouten flödar om snyggt, och det fungerar med alla layoutmotorer | Positionerna hoppar när man döljer något |
| **B. Dölj i SVG** | Rendera allt och sätt sedan `display:none` på dolda element via deras id | Stabil layout, snabbt | Tomma hål i bilden |
| **C. Fäll ihop subgraf** | Ersätt subgrafen med en nod i den filtrerade texten och dra om kanterna | Ger överblick i stora diagram | Kräver mer logik (kanter in och ut) |

Förslag: A som standard, B som växel ("Behåll layout"), C för subgrafer.

### Var döljningsläget sparas

1. **I källan som Mermaid-kommentar**, t.ex. `%% @hide: Logg, API-->Logg`. Kommentarer ignoreras av
   alla Mermaid-renderare. Läget följer alltså med filen i git och påverkar inte andra verktyg.
2. **Alternativt i workspace-state**, alltså lokalt och utan att röra filen.

Gör det valbart. Kommentar-varianten är det som skiljer tillägget från andra.

## 5. Fler funktioner som vore bra att ha

Förslagen bygger på vanliga klagomål på Mermaid och på vad andra diagram-som-kod-verktyg har:

- **Stora diagram blir oläsliga.** Det är det klart vanligaste klagomålet (G2, DigitalOcean, Obsidian-forum).
- **Svårt att styra layouten.** Subgrafer ignorerar sin riktning, och ELK-inställningarna är svåra att hitta.
- **Svårt att hitta fel.** Ett litet syntaxfel stoppar hela diagrammet, och det är mödosamt att leta upp raden.
- **Andra verktyg har flera vyer av samma modell.** Structurizr har filter på taggar och perspektiv,
  dubbelklick för att borra ner och flera vyer från en modell. D2 har "scenarios", alltså varianter av en baslayer.
  Mermaid saknar allt detta.

**Insats:** S = dagar, M = 1–2 veckor, L = större.
**Prio:** ★★★ = bör med tidigt, ★★ = nästa steg, ★ = senare/kanske.

### Zoom och panorering (hög prioritet)

Zoom är en grundförutsättning för stora diagram. Befintliga tillägg har bara enkel pan/zoom.
Det som saknas är att zoomen samverkar med trädet och med döljningen.

| Funktion | Vad/varför | Insats | Prio |
|---|---|---|---|
| **Grundzoom** | Ctrl+scroll, nyp på styrplattan, tangenterna `+` `-` `0`, och dra för att panorera. Zoomen sker mot muspekaren, inte mot mitten. | S | ★★★ |
| **Anpassa** | Knappar för "Anpassa till fönster", "Anpassa bredd", "100 %" och "Zooma till markering". | S | ★★★ |
| **Zooma till nod från trädet** | Klick på en nod eller subgraf i arbetsträdet zoomar och centrerar mjukt på den. | S | ★★★ |
| **Zoomen behålls** | Zoom och position ligger kvar när du redigerar koden, döljer element eller byter layout. Den markerade noden hålls kvar på samma plats på skärmen. Det är viktigt eftersom strategi A gör att layouten flödar om. | M | ★★★ |
| **Skarp rendering** | Zooma genom att ändra SVG:ns `viewBox` i stället för CSS-skalning. Då blir text och linjer skarpa på alla zoomnivåer. | S | ★★★ |
| **Minikarta** | En liten översikt i ett hörn med en ruta som visar var du är. Dra rutan för att flytta dig. | S | ★★ |
| **Semantisk zoom** | Utzoomat syns bara subgrafer som hopfällda block. När du zoomar in fälls de ut och detaljerna visas, ungefär som i en karta. Det kopplar zoomen till hopfällningen i trädet, och jag hittade inget annat Mermaid-verktyg som gör det. | L | ★★ |
| **Kom ihåg per fil** | Zoomnivå och position sparas per fil och per sparad vy. | S | ★★ |
| **Zoom i Markdown-preview** | Diagram inuti `.md`-filer kan öppnas i ett zoombart helskärmsläge. Det löser problemet med breda diagram i smala dokument. | S | ★★ |
| **Exportera det du ser** | Exporterar exakt det utsnitt som syns på skärmen, i vald upplösning. | S | ★★ |

Kandidater till zoombibliotek att utvärdera i spiken: `d3-zoom`, `@panzoom/panzoom` och
`svg-pan-zoom`. En egen `viewBox`-lösning på cirka 200 rader är också ett alternativ, och då har vi full kontroll över "zoomen behålls".

### A. Vyer och navigering (bygger vidare på arbetsträdet)

| Funktion | Vad/varför | Insats | Prio |
|---|---|---|---|
| **Sparade vyer** | Namngivna uppsättningar dolda element, t.ex. "Backend", "Översikt", "Felflöde". De sparas som `%% @view Backend: hide …` och väljs i en lista. Motsvarar Structurizrs vyer och D2:s scenarios. | M | ★★★ |
| **Fokusläge** | Välj en nod och visa bara den och dess grannar N steg bort, uppströms och/eller nedströms. Tänkt för stora diagram. | S | ★★★ |
| **Visa väg A → B** | Markera alla vägar mellan två noder och tona ned resten. | S | ★★ |
| **Djupnivå** | Visa subgrafer ner till nivå N och fäll ihop resten. En användare efterfrågar detta i Obsidian-forumet. | S | ★★ |
| **Taggar och filter** | `%% @tag databas: DB1, DB2`. Trädet kan sedan filtreras på taggar, som i Structurizr. | M | ★★ |
| **Borra ner** | Dubbelklick på en hopfälld subgraf öppnar den som eget diagram. En nod kan också länka till en annan `.mmd`-fil. | M | ★★ |
| **Sök och minikarta** | Sök i preview med markering, plus en minikarta för stora diagram. | S | ★★ |
| **Stegvis visning** | Element tänds i en bestämd ordning, för presentationer och genomgångar. | M | ★ |

### B. Layout och läsbarhet

| Funktion | Vad/varför | Insats | Prio |
|---|---|---|---|
| **Jämför layouter** | Samma diagram renderat med dagre, elk, elk.stress m.fl. sida vid sida. Klicka på det bästa så skrivs valet till frontmatter. | S | ★★★ |
| **Läsbarhetsanalys (lint)** | Varnar för för många noder, långa etiketter, för stort djup och många kantkorsningar. Föreslår att diagrammet delas upp. Inspirerat av mermaid-sonar. | M | ★★ |
| **Layout per subgraf** | Högerklicka på en subgraf i trädet och välj en egen algoritm, via Mermaid 12:s `@{ algorithm: … }`. | S | ★★ |
| **Reglage för etikettbredd** | Standardbrytningen på 200 px gör att diagram blir långa och smala. | S | ★★ |
| **Stabil layout** | Färre hopp när man redigerar, via `considerModelOrder` och ett fast `handDrawnSeed`. | S | ★★ |
| **Dela upp diagram** | Flytta ut en subgraf till en egen fil och lämna kvar en länknod. | M | ★ |

### C. Redigering (språkstöd)

| Funktion | Vad/varför | Insats | Prio |
|---|---|---|---|
| **Feldiagnostik med exakt rad** | Felet visas som en röd understrykning på rätt rad, med en förklaring på svenska eller engelska. | S | ★★★ |
| **Byt namn på nod** | F2 på ett nod-id uppdaterar alla referenser. Går även att göra från trädet. | S | ★★★ |
| **Autocomplete och hover** | Föreslår befintliga nod-id:n, former och pilsyntax. Hover visar nodens etikett och kopplingar. | M | ★★ |
| **Gå till definition och hitta referenser** | Fungerar för noder, subgrafer och klasser. | S | ★★ |
| **Snabbfixar** | Rättar vanliga fel som `end` som nod-id och specialtecken i etiketter som behöver citattecken. | S | ★★ |
| **Redigera via trädet** | Dra en nod till en annan subgraf, ta bort en nod med dess kanter, lägg till en kant. Koden uppdateras. | M | ★★ |
| **Formatering** | Indragning och sortering av Mermaid-kod (Format Document). | S | ★ |

### D. Utseende

| Funktion | Vad/varför | Insats | Prio |
|---|---|---|---|
| **Stil via trädet** | Välj noder och sätt färg eller form från en palett. Det genererar `classDef`/`class` i koden. | M | ★★★ |
| **Temaeditor** | Reglage för `themeVariables` med live-preview. Resultatet sparas som ett gemensamt tema för hela repot, så alla diagram ser lika ut. | M | ★★ |
| **Följ VS Code-temat** | Byter automatiskt mellan ljust och mörkt Mermaid-tema. | S | ★★ |
| **Ikonpaket** | Stöd för Mermaids `registerIconPacks`, för arkitekturdiagram. | S | ★ |

### E. Export, delning och Git

| Funktion | Vad/varför | Insats | Prio |
|---|---|---|---|
| **Exportera aktuell vy** | SVG, PNG eller PDF av det som syns, alltså utan dolda element. Kan även exportera alla sparade vyer på en gång. | S | ★★★ |
| **Kopiera filtrerad kod** | Kopierar Mermaid-koden för den aktuella vyen, för att klistra in i README eller wiki. | S | ★★ |
| **Visuell diff** | Jämför ett diagram mellan två Git-versioner, med tillagda noder i grönt och borttagna i rött. Inget av tilläggen jag hittade erbjuder det. | L | ★★ |
| **CLI för CI** | Renderar sparade vyer till bilder i en build-pipeline. | M | ★ |

### F. AI (valfritt)

"Förklara diagrammet" och "generera från kod" finns redan i Mermaid Chart. Det skulle inte skilja
oss från dem. **Låg prio**, och i så fall som en enkel koppling till Copilot eller Claude.

### Rekommendation

Tilläggets identitet blir **"Mermaid som en navigerbar modell"**: arbetsträd, vyer, fokusläge och
refaktorering. De sakerna gör stora diagram hanterbara, och det är där Mermaid är svagast och där
ingen konkurrent finns. Utseendet (B, D) gör tillägget trevligt men är inte det som skiljer det från andra.
**Visuell diff** är en stark men dyr differentierare, så den bör vänta till efter MVP.

## 6. Arkitektur (skiss)

```
Extension host (TypeScript)                 Webview (preview)
├─ TreeDataProvider  ◀── modell ──────────  mermaid.parse / getDiagramFromText
│   (TreeItem.checkboxState)                  → db.getVertices/getEdges/getSubGraphs
├─ Filter-motor (text → filtrerad text) ──▶  mermaid.render(filtrerad text)
├─ Sync editor ⇄ träd ⇄ preview              klick på SVG-element → postMessage
└─ Konfig-verktygsrad → frontmatter          pan/zoom, export
```

- VS Code har inbyggda kryssrutor i trädvyer (`TreeItem.checkboxState`), så vi slipper bygga egna.
- **Parsning:** använd Mermaids egen parser i webviewen och skicka modellen till trädet. Då
  följer vi exakt samma tolkning som renderingen. `@mermaid-js/parser` täcker ännu inte
  flowchart. Det är tänkbart att det bara går att nå den interna diagram-db:n via ett ej
  publikt API (**risk, verifieras i spike**).
- Radnummer för "hoppa till rad" måste troligen räknas fram med en egen enkel lexer, eftersom Mermaids db inte sparar källpositioner.

## 7. Föreslagen MVP

1. Preview-webview för `.mmd` och ` ```mermaid `-block (Mermaid 12), med **fullgod zoom**:
   grundzoom, anpassa-knappar, skarp `viewBox`-zoom, zoom till nod från trädet och zoom som behålls vid ändringar.
2. Arbetsträd för **flowchart**: noder, kanter och subgrafer med kryssrutor.
3. Döljning via strategi A, plus växel för B.
4. **Fokusläge**: en nod och dess grannar N steg bort.
5. Verktygsrad för layout, look och tema, plus **jämför layouter**. Valet skrivs till frontmatter.
6. Klick i trädet markerar i preview och i editorn.
7. **Feldiagnostik med exakt rad** och **byt namn på nod**.
8. **Exportera aktuell vy** till SVG/PNG.

**Version 2:** minikarta, zoom i Markdown-preview, semantisk zoom, sparade vyer (`%% @view`), hopfällning av subgrafer och djupnivå, stil via trädet,
taggar, läsbarhetsanalys och fler diagramtyper (state, class, ER, sekvens).
**Version 3:** visuell diff, borra ner mellan filer, temaeditor och CLI.

## 8. Risker och öppna frågor

- **Intern diagram-db:** API:t kan ändras mellan Mermaid-versioner. Gör en spike först.
- **Sekvensdiagram:** att dölja en deltagare kräver att man också tar bort dess meddelanden, och då ändras betydelsen.
- **Konflikt med andra tillägg:** inbyggt Mermaid-stöd och Mermaid Chart registrerar också preview.
  Vår preview bör vara ett eget kommando eller en egen editor.
- **Kräver Node 22.12+ och ES2024** (Mermaid 12). Det går bra i VS Code-webviews.

## 9. Spike-resultat (2026-10-26)

Spiken är ett fungerande VS Code-tillägg i den här mappen, med Mermaid 12.1.0.

**Så provar du:** öppna mappen i VS Code och tryck F5. Det startar ett nytt fönster med
`samples/`. Öppna `demo.mmd`, klicka på förhandsvisningsikonen och se panelen
**Mermaid-struktur** i Explorer.

### Det här fungerar och är verifierat

| Del | Status | Hur det verifierades |
|---|---|---|
| Egen parser för flowcharts: noder, kanter, kedjor, `&`, subgrafer, etiketter, alla länktyper | ✅ | 10 enhetstester (`npm test`) |
| Filtrering: dölj nod, kant eller subgraf. Tomma subgrafer tas bort. `style`, `class` och `linkStyle` justeras. | ✅ | Enhetstester, plus 6 filtrerade varianter som Mermaid renderar utan fel |
| Oförändrade rader behålls exakt | ✅ | Enhetstest: utan dolda element blir texten identisk |
| Zoom via `viewBox`, skarp på alla nivåer | ✅ | Webbläsartest |
| Zoom mot muspekaren (Ctrl+scroll eller nyp) | ✅ | Punkten under pekaren flyttar sig mindre än 1 px |
| Zoom till nod eller subgraf med mjuk animering | ✅ | Webbläsartest |
| **Zoomen behålls vid döljning.** Den markerade noden står kvar på samma pixel trots att layouten ändras. | ✅ | Webbläsartest: (512, 401) före och efter |
| Klick i diagrammet ger nodens id, så trädet och editorn kan följa med | ✅ | Webbläsartest |
| Layout (dagre, elk, elk.stress, …) och stil (neo, classic, handDrawn) | ✅ | Alla renderar. ELK ingår i `mermaid.min.js`. |
| Trädvy med kryssrutor, "Visa allt", "Visa bara grannar", hoppa till rad | ⚠️ | Kompilerar, men är **inte provat i VS Code än** |

### Lärdomar

- **Mermaids interna diagram-db behövs inte.** En egen parser behövs ändå för att få fram radnummer
  och kunna skriva om texten. Den största risken från utredningen är därmed borta.
- **SVG-id:n i Mermaid 12:** noder heter `<renderId>-flowchart-<nodId>-<n>` och subgrafer `<renderId>-<id>`.
  Det finns inget `data-id`. I stilen `handDrawn` har noderna klassen `rough-node` i stället för `node`.
- **Subgrafer utan id** får id:t `subGraphN` av Mermaid, numrerat i den ordning de **stängs**. Parsern gör likadant.
- **En dold panel har storleken 0.** Anpassningen måste vänta tills panelen får en riktig storlek.
- Testverktyget kunde inte skicka Ctrl tillsammans med scroll. Zoomen verifierades därför med syntetiska wheel-händelser.
- **`%%` i radslut är ett syntaxfel i Mermaid 12.1 för flowcharts.** Parsern lämnar därför sådana rader
  orörda, så att förhandsvisningen visar samma fel som Mermaid.
- **Strängar över flera rader** (`A["Rad ett` + ny rad + `Rad två"]`), även markdown-strängar, ger i
  Mermaid 12.1 **inget fel**. I stället tappas resten av diagrammet tyst. Det är dokumenterad syntax och ser
  ut som ett fel i Mermaid. Parsern stöder syntaxen, så trädet kan visa noder som förhandsvisningen saknar.
  Bör bevakas med ett kontraktstest och rapporteras till Mermaid.
- Kontrollen mot riktiga Mermaid hittade båda punkterna ovan. Enhetstesterna kunde inte göra det,
  eftersom de bara speglar vår egen tolkning. Det är ett starkt argument för automatiska kontraktstester.

### Tester

| Kommando | Vad | Tid |
|---|---|---|
| `npm run test:unit` | Parser och zoom-matematik (rena funktioner) | under 1 s |
| `npm run test:contract` | Riktiga Mermaid i headless Chrome/Edge via playwright-core | ca 15 s |
| `npm test` | Allt | ca 30 s |

Kontraktstesterna kräver Chrome eller Edge (välj med `MERMAID_TEST_BROWSER=chrome|msedge`). De innehåller:
- **Inlärningstester** som låser fast Mermaids beteende: SVG-id:n, `rough-node` i handDrawn, kantritning,
  att ELK och dagre ger samma id:n, och de två kända felen i Mermaid 12.1. Om något av dem slår fel efter
  en uppgradering av Mermaid har beteendet ändrats.
- **Kontrakt parser ⇄ Mermaid:** varje exempelfil i `samples/` renderas ofiltrerad, med varje enskilt element
  dolt, med alla noder i varje subgraf dolda och i fokusläge för varje nod. Varje gång ska Mermaid rita exakt de
  noder, kanter och subgrafer som parsern säger är synliga.

Alla tester har verifierats att kunna bli röda: inlärningstesterna genom ändrade förväntningar, kontrakten
genom att återinföra spikens fel med tomma subgrafer. Det första kontraktet fångade **inte** det felet.
Testerna med dolda subgrafnoder och fokusläge lades till för att täcka luckan.

### Inte med i spiken

Strategi B (dölja i SVG och behålla layouten), hopfällning av subgrafer, `%% @hide` i källan,
Mermaid-block i Markdown-filer, andra diagramtyper än flowchart, minikarta och export.

## Källor

- [Mermaid Chart VS Code-tillägg (GitHub)](https://github.com/Mermaid-Chart/vscode-mermaid-chart/)
- [Mermaid Preview (GitHub)](https://github.com/mermaid-chart/vscode-mermaid-preview)
- [Mermaid 12.0.0 release notes](https://newreleases.io/project/github/mermaid-js/mermaid/release/mermaid@12.0.0)
- [Mermaid syntax reference (layout/look)](https://mermaid.js.org/intro/syntax-reference)
- [Mermaid config schema](https://mermaid.js.org/config/schema-docs/config.html)
- [Mermaid layouts (Mintlify)](https://www.mintlify.com/mermaid-js/mermaid/configuration/layouts)
- [Merlay (Obsidian)](https://www.obsidianstats.com/plugins/merlay)
- [mermaid-viewer](https://awesome.ecosyste.ms/projects/github.com%2Fonlyutkarsh%2Fmermaid-viewer)
- [Markdown i VS Code / inbyggt Mermaid-stöd](https://macmdviewer.com/blog/markdown-in-vscode)
- [Obsidian-forum: fälla ihop subgrafer](https://forum.obsidian.md/t/collapsing-a-lower-level-graph/63665)
- [Obsidian-forum: storlek på Mermaid-diagram](https://forum.obsidian.md/t/let-the-user-decide-the-size-and-alignment-of-mermaid-diagrams/7019/37)
- [G2-recensioner av Mermaid](https://www.g2.com/products/mermaid/reviews)
- [DigitalOcean: Mermaid-riktlinjer](https://docs.digitalocean.com/style/hugo/mermaid)
- [mermaid-sonar: komplexitetsanalys](https://dev.to/entropicdrift/mermaid-sonar-detecting-hidden-complexity-in-diagram-documentation-3461)
- [TUnit: etikettbrytning i stora diagram](https://github.com/thomhurst/TUnit/pull/6485)
- [Mermaid GitHub-veckorapport (layoutfrågor)](https://buttondown.com/weekly-project-news/archive/weekly-github-report-for-mermaid-august-31-2026/)
- [Hacker News om Mermaid](https://hn.nuxt.dev/item/41260127)
- [Structurizr features](https://docs.structurizr.com/features)
- [Structurizr export-jämförelse](https://docs.structurizr.com/export/comparison)
- [D2 scenarios](https://d2lang.com/tour/scenarios/)
