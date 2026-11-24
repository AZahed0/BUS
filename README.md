# Den Helder Buslijnenkaart

Interactieve kaart van buslijnen en bushaltes in Den Helder. De app is gebouwd met Leaflet en gebruikt de lokale GeoJSON-dataset.

**Live kaart:** https://azahed0.github.io/BUS/

## Functies

- Buslijnen en bushaltes op een interactieve kaart.
- Buslijnen kiezen en zoeken op halte, buslijn of adres.
- Adressuggesties via de PDOK Locatieserver.
- Bushalte-pictogrammen met haltenaam bij hover en halte-/businformatie bij aanklikken.
- Basiskaarten: Esri Topografisch, OpenStreetMap en PDOK Luchtfoto.
- Startweergave gericht op Den Helder.

## Bestanden

- `index.html` — pagina en interface.
- `style.css` — vormgeving en mobiele weergave.
- `app.js` — kaart, interacties en zoekfuncties.
- `lijnen_en_haltes_den_helder.geojson` — buslijnen en bushaltes.

## Lokaal starten

Zet de vier projectbestanden in dezelfde map en start vanuit die map een lokale webserver:

```powershell
python -m http.server 4173
```

Open daarna <http://localhost:4173/>. Open `index.html` niet rechtstreeks via `file://`; de browser kan dan het GeoJSON-bestand blokkeren.

## Publiceren

De website wordt gehost via GitHub Pages vanaf de `main`-branch en de hoofdmap (`/`). De externe kaarttegels en PDOK-adreszoekdienst laden online vanuit hun respectievelijke diensten.

## Bronnen en attributie

- Kaarttegels: Esri, OpenStreetMap-bijdragers en PDOK/Beeldmateriaal Nederland, afhankelijk van de gekozen basiskaart.
- Adreszoekfunctie: PDOK Locatieserver.
- Buslijnen en bushaltes: `lijnen_en_haltes_den_helder.geojson`.
