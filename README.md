# Feltouch KPI Modülü

## Kurulum

```bash
# 1. Bağımlılıkları kur
npm install

# 2. Veritabanını oluştur ve seed et
npm run seed

# 3. Sunucuyu başlat
npm start
```

Uygulama: **http://localhost:3000**

## Demo Kullanıcılar

| Kullanıcı    | Şifre     | Rol        |
|--------------|-----------|------------|
| moderator    | change-me | Moderatör  |
| yigit        | change-me | Çalışan    |
| sena         | change-me | Çalışan    |
| asli         | change-me | Çalışan    |
| emrullah     | change-me | Çalışan    |
| cansu        | change-me | Çalışan    |

> ⚠️ Üretime geçmeden şifreleri ve `SESSION_SECRET`'ı değiştirin.

## Yeniden Seed

Veritabanını silip baştan oluşturmak için:
```bash
npm run reseed
```

## Dosya Yapısı

```
├── server.js          # Express API + session
├── db.js              # SQLite şema
├── compute.js         # KPI hesaplama mantığı
├── seed.js            # Veritabanı seed
├── seed.json          # Başlangıç verisi (çalışanlar, KPI'lar, hedefler)
├── kpi.db             # SQLite DB (otomatik oluşturulur)
└── public/
    ├── login.html
    ├── employee.html
    ├── moderator.html
    ├── styles.css
    ├── feltouch_antrasit.png   ← Logoyu buraya kopyalayın
    └── js/
        ├── api.js
        ├── utils.js
        ├── login.js
        ├── employee.js
        └── moderator.js
```

## Önemli Notlar

- **Logo**: `feltouch_antrasit.png` dosyasını `public/` klasörüne kopyalayın.
- **Çeyrek Hedefleri**: Her hedef satırı için Q1–Q4 hedefleri bağımsız olarak atanabilir. Boş bırakılan çeyrekler otomatik olarak "N/A" sayılır ve hesaplamaya dahil edilmez.
- **Moderatör**: Hedef satırlarının tüm 4 çeyrek hedefini aynı ekranda düzenleyebilir.
- **Çeyrek Kilidi**: Moderatör çeyrekleri kilitleyerek çalışanların değişiklik yapmasını engelleyebilir.

## KPI Hesaplama Mantığı

- `Başarı = min(gerçekleşen / hedef, 1)`
- `KPI başarısı = hedef satırlarının ağırlıklı ortalaması`
  - `count` tipinde ağırlık = hedef değeri
  - `ratio` / `score` tipinde ağırlık = 1
- `Çeyrek toplam skoru = Σ(KPI skoru × KPI ağırlığı / 100)`
- `H1 = (Q1 + Q2) / 2` · `H2 = (Q3 + Q4) / 2`
- `Çalışan net bonus = yarıyıl hakediş × (yarıyıl skoru / 100)`
- `Yönetici (Necmi) bonus = (yıllık bonus / 4) × (çeyrek ekip skoru / 100)`
