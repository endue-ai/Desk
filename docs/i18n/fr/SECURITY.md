> Ce document est une traduction. En cas de divergence, la [version anglaise](../../../SECURITY.md) fait foi.

# Politique de sécurité

## Signaler une vulnérabilité

Merci de ne pas ouvrir d'issue publique. Signalez-la en privé, au choix :

- Écrivez à team@endue.ai avec « security » dans l'objet.
- Ou utilisez le bouton GitHub « Report a vulnerability » dans l'onglet Security de ce dépôt.

Indiquez ce que vous avez trouvé, comment le reproduire, la version et l'OS concernés, et l'impact que vous
anticipez.

## La suite

| Étape | Délai visé |
| --- | --- |
| Accusé de réception | sous 3 jours ouvrés |
| Première évaluation et gravité | sous 10 jours ouvrés |
| Publication du correctif | aussi vite que la gravité l'exige |
| Divulgation publique | à la sortie du correctif, et au plus tard 90 jours après le signalement |

Nous citons les auteurs des signalements dans les notes de version, sauf si vous nous demandez de ne pas le
faire.

## Versions prises en charge

Desk est en version pré-1.0. Seule la dernière version de chaque canal (stable, beta, canary) reçoit des
correctifs de sécurité.

## Périmètre

Dans le périmètre : l'app de bureau, les crates Rust, les paquets TypeScript, les plugins intégrés et le
modèle de permissions du pont (un plugin ou un agent qui accède à une primitive sans permission constitue une
vulnérabilité).

Hors périmètre : les plugins tiers et les services extérieurs à ce dépôt (signalez-les à endue à la même
adresse).

## Modèle de menace

[docs/security/threat-model.md](../../security/threat-model.md) (en anglais) décrit ce que Desk protège, les
attaquants pris en compte et, pour chaque frontière de confiance, la protection en place sur `main`
aujourd'hui ou la lacune qui reste, avec le ticket qui la comble.
