# Kur buvau

„iPhone“ programėlės prototipas, kuris lokaliai nuskaito nuotraukų GPS vietas ir parodo jas žemėlapyje. Ši versija naudoja „Expo SDK 54“, suderinamą su vieša „Expo Go“ versija iš „App Store“.

## Kas jau veikia

- prieigos prie „Photos“ bibliotekos užklausa;
- visų nuotraukų su GPS vieta nuskaitymas;
- galerijos nuskaitymas mažomis 200 nuotraukų partijomis;
- pažangos išsaugojimas ir tęstinumas po programėlės uždarymo;
- vietinė SQLite duomenų bazė vietoje visų rezultatų laikymo RAM;
- automatinis taškų grupavimas pagal žemėlapio mastelį;
- filtravimas pagal metus;
- vietos nuotraukų peržiūra;
- pasirinktos vietos atidarymas „Google Maps“;
- KML eksportas į „Google Maps“ arba „Google Earth“;
- nuskaitytų vietų saugojimas tik telefone.

## Paleidimas be „Mac"

1. „iPhone“ įdiegti **Expo Go** iš „App Store“.
2. „Windows“ kompiuteryje įdiegti naujausią „Node.js LTS“.
3. Išskleisti šį projektą ir jo aplanke paleisti `npm install`.
4. Paleisti `npx expo start`.
5. „iPhone“ kamera nuskaityti terminale parodytą QR kodą.

Telefonas ir kompiuteris turi būti tame pačiame „Wi-Fi“ tinkle. Jei prisijungti nepavyksta, paleisti `npx expo start --tunnel`.

## Privatumas

Programėlė nenaudoja serverio ir neįkelia nuotraukų į internetą. Ji išsaugo tik nuotraukų vietų, datų ir vietinių identifikatorių kopiją pačiame telefone. Vienu metu apdorojama daugiausia 200 nuotraukų, o žemėlapyje į RAM įkeliami tik matomo ploto sugrupuoti taškai.
