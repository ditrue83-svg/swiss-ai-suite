# Vetrina AI-Swisse — `ai-swisse.com`

Sito statico di presentazione del SaaS. L'applicazione vive altrove, su
**`app.ai-swisse.com`** (`~/swiss-ai-suite-app`): qui non c'è codice
applicativo, solo pagine HTML e un foglio di stile.

```bash
node sync-tokens.mjs   # allinea tokens.css ai token dell'app
node build.mjs         # genera dist/
```

```
dist/
  index.html            italiano   → https://ai-swisse.com/
  impressum.html  privacy.html  condizioni.html
  de/index.html         tedesco    → /de/     + impressum, datenschutz, nutzungsbedingungen
  fr/index.html         francese   → /fr/     + impressum, confidentialite, conditions
  style.css             tokens.css + style.css concatenati
  og.png                anteprima social 1200×630
  og.html               sorgente leggibile dell'anteprima
  robots.txt  sitemap.xml
  autonoma/             una pagina per lingua, CSS incorporato, da aprire con un doppio clic
```

Per vederlo in locale: `python3 -m http.server 8745 --directory dist`
(c'è una voce `ai-swisse-landing` in `~/.claude/launch.json`).

## Ordine delle sezioni, e perché

promessa → come funziona → esempio → moduli → verificabilità → lingue →
**quello che è giusto sapere** → prezzi → chi c'è dietro → contatti.

I limiti stanno **prima** dei prezzi di proposito: chi legge una cifra deve già
sapere che cosa il prodotto non fa. Metterli dopo sarebbe far firmare prima e
leggere poi.

## Regole sui contenuti

In `content.mjs` non si scrive nulla che il prodotto non faccia già. Non
compaiono:

- «prova gratuita» o «14 giorni» — non esiste un trial;
- «dati in Svizzera» — il progetto Supabase è a Francoforte (`eu-central-1`),
  quindi si scrive «in Europa», e lo si dice in una sezione dedicata invece che
  in fondo alla pagina;
- «ricerca automatica nel registro IDI» — Zefix è deployato ma inerte;
- **le funzioni dei piani alti dell'applicazione** — posta amministrativa
  automatica, workflow, monitoraggio continuo, gestione multi-cliente. Sono
  elencate in `PricingPage.tsx` ma **non esistono**: metterle in vetrina
  sarebbe vendere un prodotto che non c'è. Per questo la sezione prezzi non
  elenca le funzioni dei piani.

L'**esempio di risultato** è ricostruito con dati fittizi ed è etichettato come
tale. Non è uno screenshot: una schermata reale mostrerebbe la ragione sociale e
i documenti di un'impresa vera.

## Prezzi: perché non ci sono quattro schede

Il listino non è definito e nessun pagamento è implementato. Quattro cifre in
vetrina sarebbero destinate a cambiare, e il JSON-LD le avrebbe dichiarate ai
motori di ricerca come se fossero un'offerta ferma. La sezione dichiara che il
listino si sta definendo con le imprese pilota, elenca **gli assi su cui i piani
si differenzieranno** — che sono veri oggi — e porta al contatto.

Di conseguenza il blocco JSON-LD **non contiene `offers`**: dire una cosa alla
persona e un'altra al motore di ricerca è comunque dire una cosa falsa.

## Token: derivati, non copiati

`tokens.css` è **generato**: `node sync-tokens.mjs` estrae il blocco `:root` e
la sua variante scura da `src/styles/app.css` dell'applicazione.

Erano stati copiati a mano e avevano già iniziato a divergere — `theme-color`
era rimasto su un blu che l'accento dell'app non aveva più. Chi arriva dalla
vetrina e crea un account non deve avere l'impressione di cambiare prodotto.

```bash
node sync-tokens.mjs --check   # esce 1 se tokens.css è rimasto indietro
```

Per cambiare un colore: si cambia **nell'app**, poi si rilancia lo script.
`tokens.css` non va modificato a mano.

## L'anteprima social

`static/og.png` (1200×630) viene copiata in `dist/` dal build. X e Facebook non
renderizzano SVG e su questa macchina non c'è un convertitore, quindi è stata
disegnata su canvas nel browser e scaricata. `dist/og.html` resta come sorgente
leggibile: stessa promessa, stesso accento, apribile e fotografabile.

Per rifarla: aprire una pagina qualsiasi del sito e incollare nella console il
codice che disegna il canvas (è in fondo a questo file), oppure aprire `og.html`
e catturare l'area a 1200×630.

## Cosa manca

- **L'hosting non è ancora deciso.** Con i nameserver su Aruba il CNAME non è
  ammesso sull'apex, quindi non basta un secondo progetto Cloudflare Pages. Le
  strade: spazio web Aruba via FTP, la landing su `www` con un redirect
  dall'apex, oppure spostare i DNS su Cloudflare — che però obbliga a ricreare
  gli MX delle caselle email attive.
- **I dati legali.** Ogni segnaposto `[DA COMPLETARE]` è visibile anche nella
  pagina resa, in ambra: un segnaposto che si confonde col testo finisce
  pubblicato. Servono ragione sociale, forma giuridica, sede, IDI, e la revisione
  di un legale per le condizioni d'uso e per la base giuridica del trasferimento
  dei dati fuori dall'UE.
- **Tedesco e francese non sono stati riletti da un madrelingua**, come quelli
  dell'app: vanno aggiunti a `docs/revisione-traduzioni.md` del progetto
  principale.

## Il vecchio `~/ai-swisse-sito`

È un'altra cosa: `index.html` intitolato «Accendi la tua presenza digitale»,
un'offerta da agenzia digitale. Non è stato toccato.

---

### Codice per rigenerare `static/og.png`

Da incollare nella console del browser su una pagina del sito; scarica `og.png`.

```js
const W=1200,H=630, c=document.createElement('canvas'); c.width=W; c.height=H;
const x=c.getContext('2d'); x.fillStyle='hsl(207, 88%, 32%)'; x.fillRect(0,0,W,H);
const FONT='-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
x.fillStyle='rgba(255,255,255,0.16)';
const r=16, mx=84, my=68, ms=68;
x.beginPath(); x.moveTo(mx+r,my); x.arcTo(mx+ms,my,mx+ms,my+ms,r); x.arcTo(mx+ms,my+ms,mx,my+ms,r);
x.arcTo(mx,my+ms,mx,my,r); x.arcTo(mx,my,mx+ms,my,r); x.closePath(); x.fill();
x.strokeStyle='#fff'; x.lineWidth=5; x.lineCap='round';
x.beginPath(); x.moveTo(mx+ms/2,my+18); x.lineTo(mx+ms/2,my+ms-18);
x.moveTo(mx+18,my+ms/2); x.lineTo(mx+ms-18,my+ms/2); x.stroke();
x.fillStyle='#fff'; x.font='800 40px '+FONT; x.fillText('AI-Swisse', mx+ms+18, my+34);
x.fillStyle='rgba(255,255,255,0.82)'; x.font='400 22px '+FONT;
x.fillText('per le PMI svizzere', mx+ms+18, my+64);
x.fillStyle='#fff'; x.font='800 62px '+FONT;
const words='La posta dell’amministrazione, tradotta in cose da fare.'.split(' ');
let line='', y=300; const maxW=W-168, lines=[];
for(const w of words){const t=line?line+' '+w:w; if(x.measureText(t).width>maxW&&line){lines.push(line);line=w;}else line=t;}
lines.push(line); for(const l of lines){x.fillText(l,84,y); y+=70;}
x.font='400 24px '+FONT; x.fillStyle='rgba(255,255,255,0.9)'; x.fillText('ai-swisse.com',84,H-62);
x.font='400 20px '+FONT; x.fillStyle='rgba(255,255,255,0.8)';
const langs='Italiano  ·  Deutsch  ·  Français';
x.fillText(langs, W-84-x.measureText(langs).width, H-62);
const a=document.createElement('a'); a.download='og.png'; a.href=c.toDataURL('image/png');
document.body.appendChild(a); a.click(); a.remove();
```
