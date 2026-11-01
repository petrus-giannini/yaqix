# yaqix — yet another qix

Clone del classico arcade **Qix** (Taito, 1981) pensato per cellulare e tablet: si gioca con due pollici, uno sul controllo direzionale e l'altro sui pulsanti **VELOCE** e **LENTO**. Su computer si gioca con due mani sulla tastiera.

Frontend statico in HTML, CSS e JavaScript puro, senza dipendenze, senza build e senza backend.

## Come si gioca

- Con il solo controllo direzionale il cursore si muove **soltanto sui bordi** già tracciati.
- Per entrare nel campo vuoto e tracciare una linea bisogna tenere premuto **VELOCE** o **LENTO**. Chiudendo la linea su un bordo, l'area che non contiene il Qix diventa tua.
- **VELOCE**: il cursore traccia in fretta, l'area vale 10 punti a cella ed è colorata di blu.
- **LENTO**: il cursore va a meno di metà velocità, l'area vale 20 punti a cella ed è colorata d'ambra. Il doppio vale solo se l'intera linea è tracciata in lento; si può passare da un pulsante all'altro anche a metà linea.
- Il livello si supera conquistando il **75%** del campo. Ogni punto percentuale oltre il 75 vale 1.000 punti di bonus.
- Il **Qix** (il groviglio colorato) non deve toccare la linea che stai tracciando.
- Le **scintille** gialle corrono sui bordi e ti colpiscono quando non stai tracciando.
- Se rilasci il pulsante a metà linea il cursore si ferma e parte la **miccia**, che risale la linea verso di te. Riprendi a tracciare prima che ti raggiunga.
- Dal livello 3 i Qix sono due: se li separi chiudendo una linea tra loro, i punti valgono doppio per il resto del livello.

### Comandi

| Azione | Touch | Tastiera, frecce | Tastiera, WASD |
|---|---|---|---|
| Muovi | pad direzionale | frecce | W A S D |
| Traccia veloce (punti ×1) | pulsante VELOCE | X | K |
| Traccia lento (punti ×2) | pulsante LENTO | Z | J |
| Pausa | pulsante pausa | P o Esc | P o Esc |

Le due combinazioni di tasti servono a giocare con due mani da entrambi i lati: frecce a destra e Z/X a sinistra, oppure WASD a sinistra e J/K a destra. Se sono premuti entrambi i tasti d'azione prevale LENTO.

Sullo schermo touch i due pulsanti sono disposti in diagonale come su un gamepad, e il pollice può scivolare dall'uno all'altro senza staccarsi.

### Impostazioni

Dall'ingranaggio in alto o dalla schermata iniziale:

- **Lingua**: italiano o inglese. Il pulsante `IT`/`EN` nella barra in alto cambia lingua al volo.
- **Disposizione**: pad a sinistra (destrimani) o pad a destra (mancini); anche la diagonale dei pulsanti si specchia.
- **Controllo direzionale**:
  - *Frecce*: croce classica, conta solo il braccio sotto il dito.
  - *Pad sensibile*: un cerchio con un pomello che segue il pollice; la direzione si ricava dalla posizione del dito rispetto al centro, con una piccola zona morta.
- **Suono**: attivo o spento.

Le impostazioni e il record restano salvati nel `localStorage` del browser.

## File

| File | Contenuto |
|---|---|
| `index.html` | struttura della pagina e testi statici marcati con `data-i18n` |
| `style.css` | aspetto e layout responsive (verticale e orizzontale, destrimani e mancini) |
| `script.js` | logica di gioco, comandi, traduzioni, audio |
| `i18n.json` | lemmi dell'interfaccia in italiano e inglese |
| `LICENSE` | testo della GNU GPL v3 |

## Traduzioni

`i18n.json` contiene, per ogni chiave, una voce per lingua:

```json
"pause.status": { "it": "Livello {level} · {score} punti", "en": "Level {level} · {score} points" }
```

I segnaposto tra graffe vengono sostituiti dal codice. Nell'HTML i testi fissi si collegano con `data-i18n="chiave"` (testo) e `data-i18n-aria="chiave"` (etichetta per screen reader).

Per aggiungere una lingua:

1. aggiungerla in `languages`, con nome, sigla e locale per il formato dei numeri;
2. aggiungere la voce corrispondente a ogni chiave di `strings`.

Una voce mancante ricade sulla lingua indicata in `default`. Alla prima apertura la lingua viene scelta in base a quella del browser.

## Avvio in locale

Il file delle traduzioni viene caricato con `fetch`, che i browser non consentono quando la pagina è aperta con doppio clic (`file://`). Serve quindi un server web qualsiasi:

```sh
python3 -m http.server 8000
# poi apri http://localhost:8000
```

Su Windows funziona lo stesso comando, con `py` al posto di `python3` se necessario.

## Pubblicazione su GitHub Pages

1. Caricare i file nella radice del repository.
2. In *Settings → Pages* scegliere *Deploy from a branch*, ramo `main`, cartella `/ (root)`.

L'unica risorsa esterna sono i caratteri Silkscreen e Chakra Petch da Google Fonts; senza rete la pagina usa caratteri di sistema.

## Licenza

Copyright © 2026 Pietro

Questo programma è software libero: puoi ridistribuirlo e/o modificarlo secondo i termini della GNU General Public License, pubblicata dalla Free Software Foundation, nella versione 3 o (a tua scelta) in una versione successiva. Testo completo in [`LICENSE`](LICENSE).

`SPDX-License-Identifier: GPL-3.0-or-later`

---

## English

**yaqix** (yet another qix) is a clone of the 1981 Taito arcade game Qix, designed for phones and tablets and played with two thumbs: one on the direction control, one on the FAST and SLOW buttons. With no button held the cursor only moves along existing edges; FAST draws quickly for normal points, SLOW draws slowly for double points. On a computer it is played with both hands on the keyboard. Plain HTML, CSS and JavaScript, no dependencies, no build step. The interface is available in Italian and English (`i18n.json`). Serve the folder over HTTP to run it locally. Licensed under GPL-3.0-or-later.
