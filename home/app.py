from flask import Flask, render_template

app = Flask(__name__)

APPS = [
    {'name': 'ClearLedger', 'path': '/clearledger/', 'blurb': 'Invoice review portal for flagged 3-way match results.'},
    {'name': 'ProcureOS', 'path': '/procureos/', 'blurb': 'Purchase orders, justification answers and supporting documents.'},
    {'name': 'ReceiptHub', 'path': '/receipthub/', 'blurb': 'Goods received records against purchase orders.'},
    {'name': 'AuditTrail', 'path': '/audittrail/', 'blurb': 'Forensic close dashboard: vendor flags, flux analysis and close status.'},
    {'name': 'MeridianGL', 'path': '/meridiangl/', 'blurb': 'GL balance sheet, intercompany log and accruals by subsidiary.'},
]


@app.route('/')
def index():
    return render_template('index.html', apps=APPS)


if __name__ == '__main__':
    app.run(debug=False, port=5000)
