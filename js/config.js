/**
 * GOAT MCH v3 — config.js
 * All constants: endpoints, facility lists, dropdown options
 */

const CONFIG = {

  EP:       'https://script.google.com/macros/s/AKfycbyZ-nBKAQHPzcagW5687LkJXLX_dHxXkUd_Ab_oFaZL8OSSbmYwO0r723bkMKc-4LPHhA/exec',
  SHEET_ID: '11pD_HK5IX1e_ojtpV7aAMQXeZqGCKxCYxJjSaIOMnL0',

  HC: [
    'Mawasi','Zourob','Japanese','Hamad','Mawiya','Maghazi','Nuseirat',
    'West Nuseirat','Burij','Dair AlBalah HC','Gaza Town HC','Rafah HC',
    'KHY HC','Tal Sultan HC','Shaboura HC','Shouka HC','AlNasser HC',
    'Beit Hanoun HC','Sheikh Radwan HC','Jabalia HC','Maan HC',
  ],

  MP: [
    'Attar','Honain','Laham','KHY Prep. Boys A/C','A.A.AZIZ Prep. Boys',
    'KHY Prep. Girls C/B','KHY Elem. Boys A&C/B','KHY Prep. Coed C',
    'KHY Elem. Coed A/E','Al-Shaaer','Water well #19','El Mofte Elem. Coed',
    'Nuseirat Prep. Girls D&F/C','Nuseirat Prep. Coed A','Nuseirat Prep. Boys D',
    'Bureij Prep. Boys B&C','D/Balah Prep. Girls A/Boys C','Asma Prep. Girls A&B',
    'Salah Eddin Prep. Boys B&A','Rimal Elem. Co-ed A&B','Daraj Elem. Co-ed A&B&D&E',
    'North Gaza Health Center MP',
  ],

  get ALL_FACS() { return [...this.HC, ...this.MP]; },

  OPTS: {
    caseType:     ['New Case','Follow Up'],
    refugee:      ['Refugee','Non-refugee','IDP'],
    status:       ['Active','Inactive','Transferred out','Delivered','Discontinued'],
    caseStatus:   ['Active','Closed - Delivery','Closed - Abortion','Defaulter'],
    defReason:    ['Phone not reachable','Refused to come','Moved / displaced','No transport','Delivered elsewhere','Security reasons','Unknown','Other'],
    defCalls:     ['1','2','3','4+'],
    presentation: ['Cephalic','Breech','Transverse','Oblique'],
    oedema:       ['None','Mild (+)','Moderate (++)','Severe (+++)'],
    gbv:          ['No','Yes - referred','Yes - not referred'],
    sti:          ['No','Yes - treated','Yes - referred'],
    disability:   ['No','Visual','Hearing','Physical','Cognitive','Multiple'],
    delivPlace:   ['Health facility','Home','Other'],
    delivType:    ['NVD','C-section','Instrumental','Other'],
    delivBy:      ['Midwife','Doctor','TBA','Other'],
    fpMethod:     ['IUD','Implant','Pills','Injectable','Condom','LAM','NFP','Other'],
    lam:          ['Yes','No'],
    yn:           ['Yes','No'],
    gender:       ['Female','Male'],
    rn:           ['Refugee','Non-refugee'],
    org:          ['UNRWA','MSF','WHO','UNICEF','MoH','Other NGO'],
    gov:          ['Khan Younis','Rafah','Middle Area','North Gaza','Gaza'],
    month:        ['January','February','March','April','May','June','July','August','September','October','November','December'],
    services:     ['ANC','PNC','FP','MHPSS','GBV','Health Education','Screening','PCC','Phone Call','MUAC','Referral','STI','Lab','Immunization','Other'],
    riskCurr:     ['Anemia','Hypertension','Diabetes','Heart disease','Renal disease','Previous C-section','Multiple pregnancy','Malposition','Polyhydramnios','Oligohydramnios','PROM','APH','Pre-eclampsia','Eclampsia','Other'],
    riskPrev:     ['Previous stillbirth','Previous neonatal death','Previous PPH','Previous CS','Previous shoulder dystocia','Other'],
  },

  EDIT_WINDOW_MS: 24 * 60 * 60 * 1000, // 24 hours
};
