# Fingerprint Attendance System - Backend

This is the cloud-based backend for the multi-device fingerprint attendance system. It handles student enrollment, session management, and real-time attendance processing.

## 🚀 Deployment (Railway)

This repository is optimized for deployment on **Railway.app**.

### Prerequisites
- Node.js installed
- MySQL Database (Local or Cloud)
- ESP32 Hardware with AS608 Fingerprint Sensor

### Setup
1. Clone the repository.
2. Run `npm install`.
3. Create a `.env` file based on `.env.example`.
4. Run `npm start`.

### Tech Stack
- **Backend:** Node.js, Express
- **Database:** MySQL
- **Frontend:** Vanilla JS, CSS3, HTML5
- **Hardware Integration:** HTTP/JSON REST API

## 📂 Project Structure
- `/public`: Web dashboard frontend.
- `/routes`: API endpoints.
- `/middleware`: Authentication and logging.
- `server.js`: Main entry point.
