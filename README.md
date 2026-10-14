# ตารางเก็บขยะ — Wat Phra Dhammakaya Bavaria

เว็บแอปแสดงวันที่รถขยะมาเก็บที่ **Heinkelstraße 1, 86343 Königsbrunn** ว่าวันไหนต้องนำถังอะไรออก
ข้อมูลมาจาก [AWB Landkreis Augsburg](https://www.awb-landkreis-augsburg.de/aktuelles/abfuhrtermine) และอัปเดตเองทุกวัน

- หน้าเว็บ: การ์ด "คืนนี้ต้องนำถังออก", รายการเก็บครั้งถัดไป, ปฏิทินรายเดือน, ตัวกรองประเภทถัง
- ปุ่ม Subscribe ลงปฏิทิน (Apple / Outlook / Google), ดาวน์โหลด `.ics`
- หน้าพิมพ์ตารางทั้งปี (A4 หน้าเดียว — กด "พิมพ์ตารางทั้งปี" แล้วเลือก Save as PDF ได้)
- ประกาศจากแอดมิน และแจ้งเตือนทางอีเมลทุกเย็นก่อนวันเก็บ

ไม่มีเซิร์ฟเวอร์: เป็นไฟล์ static + GitHub Actions ที่ดึงข้อมูลทุกวัน

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `config.json` | ที่อยู่, ถังที่องค์กรมีจริง (`enabledBins`), ชื่อเว็บ |
| `data/collections.json` | ตารางเก็บ — **สร้างอัตโนมัติ ห้ามแก้เอง** |
| `data/calendar.ics` | ไฟล์ปฏิทินสำหรับ subscribe — **สร้างอัตโนมัติ** |
| `data/announcements.json` | ประกาศ — แอดมินแก้เอง |
| `scripts/fetch-calendar.mjs` | ดึงข้อมูลจาก AWB |
| `scripts/notify.mjs` | ส่งอีเมลแจ้งเตือน |
| `.github/workflows/refresh.yml` | ดึงข้อมูล + deploy ทุกวัน |
| `.github/workflows/notify.yml` | ส่งอีเมลทุกเย็น |

## ตั้งค่าถังที่องค์กรมีจริง (`enabledBins`)

ข้อมูลของ AWB ลิสต์ถังทุกแบบที่ถนนนี้ใช้ได้ (ทั้งแบบ Tonne และ Container) ถ้าเว้นว่าง (`null`) เว็บจะแสดงทั้งหมด
ให้ใส่เฉพาะแบบที่องค์กรมีจริง เช่น

```json
"enabledBins": ["restmuell-tonne", "biotonne", "altpapier-tonne", "wertstoff", "problemabfall"]
```

| key | ถัง | รอบเก็บ |
|---|---|---|
| `restmuell-tonne` | Restmülltonne 80/120/240 ลิตร | ทุก 2 สัปดาห์ |
| `restmuell-container` | Restmüllcontainer 770/1100 ลิตร | ทุกสัปดาห์ |
| `restmuell-container-2w` | Restmüllcontainer 770/1100 ลิตร | ทุก 2 สัปดาห์ |
| `biotonne` | Biotonne | ทุก 2 สัปดาห์ |
| `altpapier-tonne` | Altpapiertonne 240 ลิตร | ทุก 4 สัปดาห์ |
| `altpapier-container` | Altpapiercontainer 1100 ลิตร | ทุก 2 สัปดาห์ |
| `wertstoff` | Wertstofftonne / Gelber Container | ทุก 2 สัปดาห์ |
| `problemabfall` | Problemabfallsammlung (ขยะอันตราย) | รอบพิเศษ |

ดูว่าถังจริงเป็นแบบไหนได้จากฉลากบนถัง หรือสอบถาม AWB (โทร 0821 3102-3221 / abfallberatung@LRA-a.bayern.de)
หลังแก้ `config.json` แล้ว push ระบบจะสร้างไฟล์ปฏิทินและเว็บใหม่ให้เอง

## ประกาศจากแอดมิน (`data/announcements.json`)

แก้ไฟล์นี้ใน GitHub ได้เลย (ปุ่มดินสอ) — เว็บจะแสดงเฉพาะประกาศที่อยู่ในช่วงวันที่

```json
[
  {
    "type": "warning",
    "title": "วันหยุดเลื่อนเก็บ",
    "body": "สัปดาห์หน้ารถมาเก็บช้ากว่าปกติ 1 วัน\nกรุณาวางถังตามประกาศ AWB",
    "from": "2026-12-20",
    "until": "2027-01-03",
    "link": { "text": "ดูที่ AWB", "url": "https://www.awb-landkreis-augsburg.de/aktuelles/abfuhrtermine" }
  }
]
```

- `type`: `"warning"` (สีแดง) หรือไม่ใส่ (สีเหลือง) · `from` / `until`: ไม่ใส่ = ไม่จำกัด · `link` ไม่บังคับ
- เป็นข้อความธรรมดา (ไม่รองรับ HTML) · ประกาศที่ยัง active จะถูกแนบไปในอีเมลแจ้งเตือนด้วย
- วันหยุดนักขัตฤกษ์ที่ทำให้วันเก็บเลื่อน **อยู่ในตารางของ AWB อยู่แล้ว** ไม่ต้องแก้เอง

## ติดตั้งครั้งแรก (GitHub Pages)

1. สร้าง repository บน GitHub แล้ว push โค้ดนี้ขึ้นไป (branch `main`)
2. Settings → Pages → Source: **GitHub Actions**
3. แท็บ Actions → "Refresh data and deploy" → Run workflow (ครั้งแรกเว็บจะขึ้นภายในไม่กี่นาที)
4. เว็บอยู่ที่ `https://<ชื่อ-account>.github.io/<ชื่อ-repo>/`

หลังจากนั้นระบบดึงข้อมูลจาก AWB และ deploy เว็บใหม่เองทุกวัน (ไฟล์ใน `data/` จะถูก commit เฉพาะเมื่อตารางเปลี่ยน)
> หน้าเว็บบน GitHub Pages ฟรีเป็นสาธารณะ ซึ่งมีแค่ที่อยู่ขององค์กร (ข้อมูลสาธารณะอยู่แล้ว) ถ้าต้องการจำกัดเฉพาะสมาชิก ต้องเปลี่ยนที่โฮสต์

## แจ้งเตือนทางอีเมล

ส่งทุกเย็น (~17:00 น. เวลาเยอรมนี) ถ้าพรุ่งนี้มีเก็บ — ถ้าไม่มีเก็บจะไม่ส่ง ผู้รับทุกคนอยู่ใน BCC

1. เตรียมบัญชี SMTP (เช่น Brevo, Mailjet, หรือ Gmail ที่เปิด App Password)
2. Settings → Secrets and variables → Actions → **Secrets** เพิ่ม:
   `SMTP_HOST`, `SMTP_PORT` (เช่น 587), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (เช่น `ตารางเก็บขยะ <noreply@example.org>`),
   `MAIL_TO` (อีเมลผู้รับคั่นด้วย comma)
3. ทดสอบ: Actions → "Evening e-mail notification" → Run workflow (ค่าเริ่มต้นเป็น dry run — ดูเนื้อหาใน log)
   แล้วลองรันอีกครั้งโดยเอาติ๊ก dry run ออกเพื่อส่งจริง (ถ้าพรุ่งนี้ไม่มีเก็บ จะไม่ส่ง)
4. เปิดการส่งอัตโนมัติ: Settings → Secrets and variables → Actions → **Variables** → เพิ่ม `NOTIFY_EMAIL` = `true`

> รายชื่อผู้รับและรหัสผ่านเก็บใน Secrets เท่านั้น ไม่อยู่ใน repository
> cron ของ GitHub ใช้เวลา UTC จึงคลาดเคลื่อน ±1 ชั่วโมงตามฤดูกาลเวลาออมแสง และอาจล่าช้าได้เล็กน้อย
> LINE: LINE Notify ปิดบริการแล้ว หากต้องการแจ้งเตือนทาง LINE ต้องสร้าง bot ผ่าน LINE Messaging API — ยังไม่รวมในเวอร์ชันนี้

## ใช้ปฏิทินในมือถือ

- **Apple / Outlook:** กดปุ่มแล้วเลือก Subscribe — อัปเดตเองเมื่อ AWB เปลี่ยนวัน และมีแจ้งเตือน 18:00 น. ของคืนก่อนวันเก็บ
- **Google Calendar:** กดปุ่มแล้วยืนยัน (Google ไม่แสดงการแจ้งเตือนของปฏิทินที่ subscribe — ตั้งแจ้งเตือนเองในการตั้งค่าปฏิทิน)
- **ดาวน์โหลด .ics:** นำเข้าครั้งเดียว ไม่อัปเดตอัตโนมัติ

## รันในเครื่อง / ทดสอบ

```bash
npm install                        # ครั้งแรก (ต้องใช้ Node 20+)
npm run fetch                      # ดึงข้อมูลจาก AWB → data/
npm run serve                      # เปิด http://localhost:8080
node scripts/notify.mjs --dry-run --today=2026-10-26   # ดูอีเมลที่จะส่งโดยไม่ส่งจริง
```

ทดสอบการแสดงผลตามวัน/เวลาอื่นด้วยพารามิเตอร์ใน URL (จะมีแถบ "โหมดทดสอบ" ขึ้นเตือน):
`http://localhost:8080/?today=2026-10-19&time=18:00` → การ์ด "คืนนี้ต้องนำถังออก"

## หมายเหตุสำคัญ

- **ที่มาของข้อมูล:** AWB แสดงปฏิทินผ่านระบบ C-Trace และเราดึงไฟล์ ICS ที่ระบบนั้นสร้างให้ — ไม่ใช่ API ที่ AWB ประกาศเป็นทางการ
  ถ้า AWB เปลี่ยนระบบ การดึงข้อมูลอาจล้มเหลว (workflow จะขึ้นสีแดงและเว็บยังแสดงข้อมูลเดิมที่เก็บไว้)
  ให้เทียบกับ [หน้าปฏิทินของ AWB](https://www.awb-landkreis-augsburg.de/aktuelles/abfuhrtermine) เป็นระยะ
- **ปีถัดไป:** AWB ประกาศตารางปีหน้าช่วงพฤศจิกายน ก่อนหน้านั้นหน้าเว็บจะแจ้งว่า "ยังไม่ประกาศ" และดึงเข้าให้เองทันทีที่ประกาศ
- **Problemabfallsammlung** (ขยะอันตราย) เป็นรอบพิเศษ ไม่ใช่วันวางถัง — เว็บจะไม่แสดงกฎ "วางก่อน 06:30" สำหรับวันนั้น และแนะนำให้ดูเวลา/จุดรับที่ AWB
- เว็บใช้เวลา Europe/Berlin เสมอ ไม่ว่าผู้ชมจะอยู่ที่ไหน
- เว็บนี้ไม่ใช่เว็บทางการของ AWB — หากวันที่ไม่ตรงกัน ให้ยึดตามประกาศของ AWB
