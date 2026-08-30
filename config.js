/*
 * Public-safe defaults for the open-source project.
 * Clinic-specific values belong in the ignored config.local.js file.
 */
const CONFIG = {
  GOOGLE_SHEETS_URL: '',
  APP_WRITE_KEY: '',
  CLINIC: {
    nameMarathi: '',
    doctorName: 'Clinic Doctor',
    qualifications: '',
    specialty: 'Clinic Management',
    regNo: '',
    address: '',
    phone: ''
  }
};

if (typeof window !== 'undefined') window.CONFIG = CONFIG;
