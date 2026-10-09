# API SMS et WhatsApp — Techsoft

Node.js 24, Express 5 et TypeScript. Les envois passent par Techsoft ; aucune base de données n'est requise. Le jeton Techsoft reste côté serveur. Chaque route `/api` exige `Authorization: Bearer <API_KEY>`.

## Démarrage

```sh
npm ci
cp .env.example .env
# Renseigner API_KEY, TECHSOFT_API_TOKEN, SENDER_ID et WHATSAPP_SENDER_ID dans .env
npm run dev
```

Sous PowerShell : `Copy-Item .env.example .env`. Générer une clé : `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

```sh
npm run check
npm test
npm run build
npm start
```

Les tests simulent Techsoft et n'envoient aucun message payant.

## Routes

| Méthode | Route | Usage |
| --- | --- | --- |
| GET | `/health` | Santé du processus, public, sans appel Techsoft |
| POST | `/api/sms/send` | SMS simple ou plusieurs numéros séparés par une virgule |
| POST | `/api/whatsapp/send` | Message WhatsApp à un numéro |
| GET | `/api/whatsapp/check/:number` | Vérifier la présence sur WhatsApp |
| GET | `/api/messages/:uid` | Consulter un message |
| GET | `/api/messages` | Historique et filtres |

SMS : `recipient`, `message` obligatoires ; `schedule_time`, `dlt_template_id` facultatifs. L’expéditeur vient de `SENDER_ID` (11 caractères maximum pour un nom). Numéros au format international (indicatif inclus, sans espaces ; le `+` initial est accepté et retiré).

WhatsApp : `recipient`, `message` obligatoires. L’expéditeur vient de `WHATSAPP_SENDER_ID` (chaîne simple, facultative), ou de `SENDER_ID` si elle est absente. Techsoft exige que cet expéditeur corresponde à un numéro WhatsApp connecté par scan. `media_url` accepte une URL HTTP(S) accessible à Techsoft (image, vidéo ou PDF selon le fournisseur). `delay: "no"` désactive son délai habituel de 15 secondes ; omettre ce champ pour conserver ce délai.

`type` est fixé par la route : `plain` pour SMS, `whatsapp` pour WhatsApp. Ne pas ajouter `type` ni `sender_id` au JSON ; un `sender_id` fourni par un client est rejeté avec une erreur 400. `schedule_time` suit le format concret de la documentation : `YYYY-MM-DD HH:mm` ; le fuseau doit être confirmé dans votre compte Techsoft, la documentation fournie étant ambiguë sur RFC3339.

```sh
curl -X POST http://localhost:3000/api/sms/send \
  -H 'Authorization: Bearer VOTRE_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"recipient":"22997000000","message":"Bonjour !"}'

curl -X POST http://localhost:3000/api/whatsapp/send \
  -H 'Authorization: Bearer VOTRE_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"recipient":"22997000000","message":"Bonjour !","media_url":"https://example.com/document.pdf"}'

curl http://localhost:3000/api/messages \
  -H 'Authorization: Bearer VOTRE_API_KEY'
```

Ces commandes utilisent la syntaxe shell Unix ; sous PowerShell, employer `curl.exe` avec une syntaxe adaptée, ou `Invoke-RestMethod` :

```powershell
$headers = @{ Authorization = 'Bearer VOTRE_API_KEY' }
$body = @{ recipient = '22997000000'; message = 'Bonjour !' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/sms/send -Headers $headers -ContentType 'application/json' -Body $body
```

Historique : `page`, `start_date` et `end_date` (ensemble, `YYYY-MM-DD HH:mm:ss`), `timezone` (IANA, par exemple `Africa/Lagos`), `sms_type`, `direction`. Dates dans le fuseau fourni, UTC par défaut chez Techsoft. Les réponses JSON du fournisseur sont conservées. Validation : 400 ; clé absente/invalide : 401 ; fournisseur indisponible : 502 ; délai dépassé : 504. Les erreurs métier Techsoft conservent leur statut documenté lorsqu'il est présent.

Aucun réessai automatique des envois : après un délai dépassé, le statut de livraison est inconnu ; vérifier l'historique avant de renvoyer pour éviter un doublon. L'application ne fournit pas d'idempotence ni de limite de débit distribuée. Garder la clé d'API dans un backend de confiance, jamais dans le navigateur public.

## Docker

```sh
docker compose up --build -d
```

Image en deux étapes, utilisateur non root et healthcheck `/health`. Le compose fourni publie le port 3000 pour un lancement local.

## Déploiement Dokploy

1. Pousser le projet dans votre dépôt Git.
2. Créer une application Dokploy et connecter le dépôt et la branche.
3. Choisir le type de build **Dockerfile**, le contexte/build path **/messaging-api** et le fichier **Dockerfile**. Si ce sous-dossier devient un dépôt autonome, utiliser **/** comme build path.
4. Dans Environment, définir `NODE_ENV=production`, `PORT=3000`, `API_KEY` (clé aléatoire de 32 caractères minimum), `TECHSOFT_API_TOKEN`, `SENDER_ID`, `WHATSAPP_SENDER_ID` et éventuellement `TECHSOFT_TIMEOUT_MS=15000`.
5. Déployer puis ajouter un domaine HTTPS dans Domains, avec le port conteneur **3000**.
6. Tester `https://votre-domaine/health` puis un envoi avec votre clé d'API.

Pas besoin de publier un port hôte pour le routage du domaine par Dokploy. Guide officiel : https://docs.dokploy.com/docs/core/deno (même procédure Dockerfile/build path/domaine, avec notre port 3000).

## Réception WhatsApp

Ce projet couvre l'envoi et la consultation. Le webhook de réception n'est pas implémenté : la documentation fournie ne décrit ni son payload ni son mécanisme d'authentification. Ajouter cette intégration après obtention de ces spécifications ; aucune réception durable ou conversation automatique n'est promise.
