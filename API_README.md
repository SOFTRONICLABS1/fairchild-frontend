# Fairchild Frontend API Flow (Current Integration)

This document describes the API flow currently implemented in the frontend pipeline, including:
- step order
- request payload structures
- how intermediate response values are reused

Base API URL:
- `http://127.0.0.1:8000/api/v1`

---

## Pipeline Step Order

1. Create post package (frontend JSON object)
2. Download and edit image (Renderform API)
3. Create WordPress post
   - Upload image to WordPress media
   - Create WordPress product with final post package
4. Schedule to Metricool

---

## Data Input Source

Selected product from `/results` provides:
- `product` (title/name)
- `productUrl`
- `price`
- `discount`
- `imageUrl`
- `platform`

Selected template from `/pipeline` provides:
- `template.identifier` (Renderform template ID)

---

## Step 1: Create Post Package (Frontend object)

The frontend builds this base structure before API calls:

```json
{
  "Image_editing_text": "Keyname_Value",
  "name": "<product name>",
  "type": "external",
  "status": "draft",
  "featured": true,
  "catalog_visibility": "visible",
  "description": "Keyname_Value",
  "short_description": "Keyname_Value",
  "external_url": "<product url>",
  "button_text": "Buy Now",
  "regular_price": "<calculated from product price>",
  "sale_price": "<product sale price or empty>",
  "images": [{ "id": 0 }],
  "meta_data": [{ "key": "vendor", "value": "Keyname_Value" }]
}
```

Notes:
- `Image_editing_text` is currently static placeholder text.
- `regular_price` and `sale_price` come from selected product pricing.

---

## Step 2: Renderform Image Edit

### API
- `POST /renderform/render`

### Payload

```json
{
  "template": "<selected template identifier>",
  "titleText": "<postPackage.Image_editing_text>",
  "imageSrc": "<selected product imageUrl>",
  "extraData": {}
}
```

### Expected response usage

From response:
- `data.href` -> rendered image URL

Used later in WordPress media upload.

---

## Step 3A: WordPress Media Upload

### API
- `POST /wordpress/media/upload`

### Request type
- `multipart/form-data`

### Form fields
- `file` (empty field is sent)
- `image_url` = Renderform `href`

Equivalent curl format:

```bash
curl -X POST \
  'http://127.0.0.1:8000/api/v1/wordpress/media/upload' \
  -H 'accept: application/json' \
  -H 'Content-Type: multipart/form-data' \
  -F 'file=' \
  -F 'image_url=<rendered href>'
```

### Expected response usage

From response:
- `data.id` -> WordPress media ID (used in post package `images[0].id`)
- `data.guid.rendered` -> public media URL (used in Metricool payload `media`)
- `data.permalink_template` -> appended to Metricool post text

---

## Step 3B: WordPress Product Create

### API
- `POST /wordpress/products`

### Final payload sent

Based on post package, but without `Image_editing_text` and with real media ID:

```json
{
  "name": "<product name>",
  "type": "external",
  "status": "draft",
  "featured": true,
  "catalog_visibility": "visible",
  "description": "Keyname_Value",
  "short_description": "Keyname_Value",
  "external_url": "<product url>",
  "button_text": "Buy Now",
  "regular_price": "<price>",
  "sale_price": "<sale price or empty>",
  "images": [{ "id": <wordpress_media_id> }],
  "meta_data": [{ "key": "vendor", "value": "Keyname_Value" }]
}
```

---

## Step 4: Metricool Schedule

### API
- `POST /metricool/scheduler/posts?userId=1981059&blogId=3410405`

### Core dynamic fields
- `text`: `"Automation Test\n<permalink_template>"`
- `media`: `[ "<wordpress media guid.rendered>" ]`
- `publicationDate.dateTime`: tomorrow datetime
- `publicationDate.timezone`: `"America/Denver"`
- `autoPublish`: `true`
- `draft`: `true`

### Payload shape used

```json
{
  "text": "Automation Test\n<permalink_template>",
  "autoPublish": true,
  "draft": true,
  "publicationDate": {
    "dateTime": "YYYY-MM-DDTHH:mm:ss",
    "timezone": "America/Denver"
  },
  "media": ["<wordpress guid.rendered>"],
  "descendants": [],
  "facebookData": { "type": "POST" },
  "firstCommentText": "",
  "gmbData": { "type": "publication" },
  "hasNotReadNotes": false,
  "instagramData": {
    "collaborators": [],
    "shareTrialAutomatically": false,
    "showReelOnFeed": true,
    "type": "POST"
  },
  "linkedinData": {
    "previewIncluded": true,
    "publishImagesAsPDF": false,
    "type": "POST"
  },
  "mediaAltText": [null],
  "performanceDashboardIds": [],
  "providers": [
    { "network": "twitter" },
    { "network": "facebook" },
    { "network": "instagram" },
    { "network": "threads" },
    { "network": "linkedin" },
    { "network": "gmb" },
    { "network": "tiktok" }
  ],
  "shortener": false,
  "smartLinkData": { "ids": [] },
  "threadsData": {
    "allowedCountryCodes": [],
    "isSpoiler": false,
    "replyControl": "EVERYONE",
    "type": "POST"
  },
  "tiktokData": {
    "autoAddMusic": false,
    "commercialContentOwnBrand": false,
    "commercialContentThirdParty": false,
    "disableComment": false,
    "disableDuet": false,
    "disableStitch": false,
    "isAigc": false,
    "photoCoverIndex": 0,
    "privacyOption": "public_to_everyone"
  },
  "twitterData": {
    "tags": [],
    "type": "POST"
  }
}
```

---

## Runtime Notes

- Pipeline runs product-by-product for items marked `Ready`.
- Step status shown in UI:
  - `waiting`
  - `running`
  - `done`
  - `failed`
- If any step fails for a product, pipeline stops and shows error.

