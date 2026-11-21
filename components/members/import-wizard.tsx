'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiClientError } from '@/lib/api/client'
import { formatInr } from '@/lib/money'
import { detectColumns, FIELD_LABEL, IMPORT_FIELDS, mapRows, parseCsv, type ImportField } from '@/lib/import/members-file'

// Members > Import: upload the old software's export, match its columns,
// check every row, then import. Nothing is saved before the last step.

type Step = 'upload' | 'columns' | 'preview' | 'done'

interface RowResult {
  row: number
  name: string
  phone: string | null
  action: 'create' | 'skip' | 'error'
  messages: string[]
  plan: string | null
  endsOn: string | null
  active: boolean
  duePaise: number
}

interface Summary {
  total: number
  create: number
  skip: number
  error: number
  activePlans: number
  expiredPlans: number
  duesPaise: number
  dueCount: number
  newPlans: string[]
  limit: { used: number; limit: number | null }
  rows: RowResult[]
}

const REQUIRED: ImportField[] = ['name', 'phone']

const TEMPLATE = [
  'Name,Mobile,Gender,Joining Date,Plan,Start Date,Expiry Date,Amount Paid,Balance,Branch,Trainer,Member ID,Remarks',
  'Harpreet Kaur,9876500101,F,05/01/2025,Quarterly,01/10/2026,31/12/2026,4500,0,Shivalik City,Inder,SF-101,',
  'Rohit Sharma,9876500102,M,12/03/2024,Monthly,15/11/2026,14/12/2026,1500,500,Zirakpur,Lakshay,SF-102,Pays on 20th',
].join('\r\n')

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)
  return String(value).trim()
}

async function readFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/universal')
    const data = await readSheet(file)
    return data.map((row) => row.map(cellText)).filter((row) => row.some((value) => value !== ''))
  }
  if (name.endsWith('.xls')) throw new Error('Old .xls files are not supported. Open it in Excel and use Save As > Excel Workbook (.xlsx) or CSV.')
  return parseCsv(await file.text())
}

export function ImportWizard({ branches, membersHref }: { branches: { id: string; name: string }[]; membersHref: string }) {
  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState('')
  const [table, setTable] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<ImportField, number | null>>(() => Object.fromEntries(IMPORT_FIELDS.map((f) => [f, null])) as Record<ImportField, number | null>)
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [busy, setBusy] = useState(false)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const headers = table[0] ?? []
  const sample = table[1] ?? []
  const rows = useMemo(() => mapRows(table, mapping), [table, mapping])
  const missing = REQUIRED.filter((field) => mapping[field] === null)

  async function load(file: File | undefined) {
    if (!file) return
    try {
      const data = await readFile(file)
      if (data.length < 2) throw new Error('The file needs a header row and at least one member.')
      setFileName(file.name)
      setTable(data)
      setMapping(detectColumns(data[0]))
      setSummary(null)
      setStep('columns')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read this file')
    }
  }

  async function run(dryRun: boolean) {
    setBusy(true)
    try {
      const result = await api<Summary>('/api/gym/members/import', { method: 'POST', body: { rows, defaultBranchId: branchId || null, dryRun } })
      setSummary(result)
      setStep(dryRun ? 'preview' : 'done')
      if (!dryRun) toast.success(`${result.create} members imported`)
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Import failed. Nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'rep-plus-member-import-template.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const visibleRows = summary ? summary.rows.filter((row) => !onlyProblems || row.action !== 'create' || row.messages.length > 0) : []
  const overLimit = summary && summary.limit.limit !== null && summary.limit.used + summary.create > summary.limit.limit

  return (
    <div className="import-wizard">
      <ol className="import-steps" aria-label="Import steps">
        {(['upload', 'columns', 'preview', 'done'] as Step[]).map((key, index) => (
          <li key={key} className={step === key ? 'on' : (['upload', 'columns', 'preview', 'done'] as Step[]).indexOf(step) > index ? 'done' : ''}>
            <span>{index + 1}</span> {key === 'upload' ? 'Upload file' : key === 'columns' ? 'Match columns' : key === 'preview' ? 'Check rows' : 'Imported'}
          </li>
        ))}
      </ol>

      {step === 'upload' ? (
        <section className="panel">
          <label
            className={`drop-zone ${dragging ? 'over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              void load(event.dataTransfer.files[0])
            }}
          >
            <FileSpreadsheet />
            <strong>Drop the member list here, or tap to choose</strong>
            <span>Excel (.xlsx) or CSV, up to 2000 members. Nothing is saved until you confirm.</span>
            <input ref={input} type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={(event) => void load(event.target.files?.[0])} hidden />
            <span className="btn btn-lime">
              <Upload /> Choose file
            </span>
          </label>
          <div className="import-help">
            <h3>Where does the file come from?</h3>
            <p>Most gym software has an export button on its members list (often called Export, Download or Excel). Export all members, including expired ones, and upload that file here as it is. Column names do not need to match: you will match them in the next step.</p>
            <p>No export button? Fill our template in Excel or Google Sheets. Only name and mobile number are required.</p>
            <button type="button" className="button-link outline small-button" onClick={downloadTemplate}>
              <Download /> Download template (CSV)
            </button>
          </div>
        </section>
      ) : null}

      {step === 'columns' ? (
        <section className="panel">
          <div className="row-between">
            <div>
              <h3 style={{ margin: 0 }}>Match the columns</h3>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {fileName} - {table.length - 1} rows. We matched what we could; check the rest.
              </p>
            </div>
            <button type="button" className="button-link outline small-button" onClick={() => setStep('upload')}>
              <ArrowLeft /> Another file
            </button>
          </div>
          <div className="map-grid">
            {IMPORT_FIELDS.map((field) => (
              <label key={field} className={`map-row ${REQUIRED.includes(field) && mapping[field] === null ? 'missing' : ''}`}>
                <span className="map-field">
                  {FIELD_LABEL[field]}
                  {REQUIRED.includes(field) ? <em> required</em> : null}
                </span>
                <select value={mapping[field] ?? ''} onChange={(event) => setMapping({ ...mapping, [field]: event.target.value === '' ? null : Number(event.target.value) })}>
                  <option value="">Not in file</option>
                  {headers.map((header, index) => (
                    <option key={index} value={index}>
                      {header || `Column ${index + 1}`}
                    </option>
                  ))}
                </select>
                <small className="map-sample">{mapping[field] !== null ? sample[mapping[field]!] || '-' : ''}</small>
              </label>
            ))}
          </div>
          <div className="field" style={{ maxWidth: 360, marginTop: 16 }}>
            <label htmlFor="import-branch">Branch for members without a branch column</label>
            <select id="import-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
          {missing.length ? <p className="field-error">Pick the column for: {missing.map((field) => FIELD_LABEL[field]).join(', ')}</p> : null}
          <button type="button" className="btn btn-dark" disabled={busy || missing.length > 0} onClick={() => run(true)}>
            {busy ? <Loader2 className="spin" /> : <CheckCircle2 />} Check {rows.length} rows
          </button>
        </section>
      ) : null}

      {(step === 'preview' || step === 'done') && summary ? (
        <>
          <div className="import-tiles">
            <div className="import-tile good">
              <strong>{summary.create}</strong>
              <span>{step === 'done' ? 'members imported' : 'members will be added'}</span>
            </div>
            <div className="import-tile">
              <strong>{summary.activePlans}</strong>
              <span>with a running plan</span>
            </div>
            <div className="import-tile">
              <strong>{summary.expiredPlans}</strong>
              <span>expired (great for renewal calls)</span>
            </div>
            <div className="import-tile">
              <strong>{formatInr(summary.duesPaise)}</strong>
              <span>balance due from {summary.dueCount} members</span>
            </div>
            <div className={`import-tile ${summary.skip ? 'warn' : ''}`}>
              <strong>{summary.skip}</strong>
              <span>already in Rep+ (skipped)</span>
            </div>
            <div className={`import-tile ${summary.error ? 'bad' : ''}`}>
              <strong>{summary.error}</strong>
              <span>rows with problems (skipped)</span>
            </div>
          </div>
          {summary.newPlans.length ? (
            <p className="tip">
              New membership plans will be created from the file: <strong>{summary.newPlans.join(', ')}</strong>. You can rename them or fix prices in Membership plans later.
            </p>
          ) : null}
          {overLimit ? (
            <p className="field-error">
              Your Rep+ plan allows {summary.limit.limit} members and you have {summary.limit.used}. This file adds {summary.create}. Upgrade your plan or remove some rows.
            </p>
          ) : null}

          <section className="panel">
            <div className="row-between" style={{ marginBottom: 10 }}>
              <div className="tab-links">
                <button type="button" className={onlyProblems ? '' : 'active'} onClick={() => setOnlyProblems(false)}>
                  All rows
                </button>
                <button type="button" className={onlyProblems ? 'active' : ''} onClick={() => setOnlyProblems(true)}>
                  Needs a look
                </button>
              </div>
              {step === 'preview' ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="button-link outline small-button" onClick={() => setStep('columns')}>
                    <ArrowLeft /> Back
                  </button>
                  <button type="button" className="btn btn-lime" disabled={busy || summary.create === 0 || Boolean(overLimit)} onClick={() => run(false)}>
                    {busy ? <Loader2 className="spin" /> : <Upload />} Import {summary.create} members
                  </button>
                </div>
              ) : (
                <Link href={membersHref} className="btn btn-lime">
                  <CheckCircle2 /> Open members
                </Link>
              )}
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Member</th>
                    <th>Plan</th>
                    <th className="num">Due</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.slice(0, 500).map((row) => (
                    <tr key={row.row}>
                      <td>{row.row}</td>
                      <td>
                        {row.name}
                        <span className="sub">{row.phone ?? '-'}</span>
                      </td>
                      <td>
                        {row.plan ?? '-'}
                        {row.endsOn ? <span className="sub">{`${row.active ? 'until' : 'ended'} ${row.endsOn.split('-').reverse().join('/')}`}</span> : null}
                      </td>
                      <td className="num">{row.duePaise ? formatInr(row.duePaise) : '-'}</td>
                      <td>
                        <span className={`import-result ${row.action}`}>
                          {row.action === 'create' ? <CheckCircle2 /> : row.action === 'skip' ? <AlertTriangle /> : <XCircle />}
                          {row.action === 'create' ? (step === 'done' ? 'Added' : 'Will add') : row.action === 'skip' ? 'Skipped' : 'Not added'}
                        </span>
                        {row.messages.map((message) => (
                          <span key={message} className="sub">
                            {message}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibleRows.length > 500 ? <p className="muted">Showing the first 500 rows.</p> : null}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
