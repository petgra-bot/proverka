# Záložka „Prověřit“ (archiv)

Bookmarklet, který na otevřeném inzerátu (Sreality, Bezrealitky, iDNES Reality) přečte v prohlížeči uživatele
polohu, ulici, plochy a podlaží a otevře prověrku s údaji v části adresy za `#inzerat=` (na server se neposílá).
Vyřazeno 31. 10. 2026: na iPadu a iPhonu je nastavení příliš těžkopádné a kód nebyl odladěný na skutečném Sreality.

## Známý problém

Na skutečném detailu Sreality (Safari, iPad) hlásila záložka „otevřete prosím detail inzerátu“: data inzerátu
nebyla v `__NEXT_DATA__` pod dotazem `estate` s `id` z adresy. Testováno bylo jen na napodobené stránce.
Před vrácením je potřeba na skutečném detailu zjistit, kde stránka data drží (např. diagnostickou záložkou,
která vypíše klíče `__NEXT_DATA__`, nebo `self.__next_f` u App Routeru).

## Jak vrátit

1. `zalozka.html` vložit do `index.html` pod formulář, `zalozka.css` do `style.css`.
2. Funkci `zalozka()` a obsluhu (`KOD_ZALOZKY`, kopírování, `.otevri-navod`) a příjem `#inzerat=` ze `zalozka.js` na konec `app.js`.
3. Do textů u odkazu ze Sreality vrátit odkaz na návod (`TIP_ZALOZKA`).

Lepší cestou na počítači je rozšíření prohlížeče, na mobilu aplikace se Sdílet (varianta A6).
