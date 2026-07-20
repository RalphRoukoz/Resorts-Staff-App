import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { supabase } from '../../lib/supabase'
import type { ResortFaq } from '../../types/database'

export function SuperInfoPage() {
  const { resortId } = useParams<{ resortId: string }>()
  const [resortName, setResortName] = useState('')
  const [publicPhone, setPublicPhone] = useState('')
  const [publicWhatsapp, setPublicWhatsapp] = useState('')
  const [arrivalNotes, setArrivalNotes] = useState('')
  const [gateNotes, setGateNotes] = useState('')
  const [faqs, setFaqs] = useState<ResortFaq[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingContact, setSavingContact] = useState(false)
  const [contactSaved, setContactSaved] = useState(false)
  const [faqModalOpen, setFaqModalOpen] = useState(false)
  const [editingFaqId, setEditingFaqId] = useState<string | null>(null)
  const [faqQuestion, setFaqQuestion] = useState('')
  const [faqAnswer, setFaqAnswer] = useState('')
  const [faqSortOrder, setFaqSortOrder] = useState('0')
  const [faqSaving, setFaqSaving] = useState(false)
  const [faqError, setFaqError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    const [resortRes, faqsRes] = await Promise.all([
      supabase
        .from('resorts')
        .select('name, public_phone, public_whatsapp, arrival_notes, gate_notes')
        .eq('id', resortId)
        .single(),
      supabase.from('resort_faqs').select('*').eq('resort_id', resortId).order('sort_order'),
    ])

    if (resortRes.error) setError(resortRes.error.message)
    else {
      const row = resortRes.data as {
        name: string
        public_phone: string | null
        public_whatsapp: string | null
        arrival_notes: string | null
        gate_notes: string | null
      }
      setResortName(row.name)
      setPublicPhone(row.public_phone ?? '')
      setPublicWhatsapp(row.public_whatsapp ?? '')
      setArrivalNotes(row.arrival_notes ?? '')
      setGateNotes(row.gate_notes ?? '')
    }

    if (faqsRes.error) setError(faqsRes.error.message)
    else setFaqs((faqsRes.data ?? []) as ResortFaq[])

    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSaveContact() {
    if (!resortId) return
    setSavingContact(true)
    setContactSaved(false)
    const { error: updateError } = await supabase
      .from('resorts')
      .update({
        public_phone: publicPhone.trim() || null,
        public_whatsapp: publicWhatsapp.trim() || null,
        arrival_notes: arrivalNotes.trim() || null,
        gate_notes: gateNotes.trim() || null,
      })
      .eq('id', resortId)
    if (updateError) setError(updateError.message)
    else setContactSaved(true)
    setSavingContact(false)
  }

  function openFaqCreate() {
    setEditingFaqId(null)
    setFaqQuestion('')
    setFaqAnswer('')
    setFaqSortOrder(String(faqs.length))
    setFaqError(null)
    setFaqModalOpen(true)
  }

  function openFaqEdit(faq: ResortFaq) {
    setEditingFaqId(faq.id)
    setFaqQuestion(faq.question)
    setFaqAnswer(faq.answer)
    setFaqSortOrder(String(faq.sort_order))
    setFaqError(null)
    setFaqModalOpen(true)
  }

  async function handleSaveFaq() {
    if (!resortId || !faqQuestion.trim() || !faqAnswer.trim()) {
      setFaqError('Question and answer are required')
      return
    }
    setFaqSaving(true)
    setFaqError(null)

    const payload = {
      resort_id: resortId,
      question: faqQuestion.trim(),
      answer: faqAnswer.trim(),
      sort_order: Number(faqSortOrder) || 0,
      is_published: true,
    }

    const { error: saveError } = editingFaqId
      ? await supabase.from('resort_faqs').update(payload).eq('id', editingFaqId)
      : await supabase.from('resort_faqs').insert(payload)

    if (saveError) setFaqError(saveError.message)
    else {
      setFaqModalOpen(false)
      await load()
    }
    setFaqSaving(false)
  }

  async function handleDeleteFaq(faq: ResortFaq) {
    if (!confirm('Delete this FAQ?')) return
    const { error: deleteError } = await supabase.from('resort_faqs').delete().eq('id', faq.id)
    if (deleteError) setError(deleteError.message)
    else await load()
  }

  if (loading) return <Spinner label="Loading guest info…" />

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link to="/superadmin/resorts" className="text-sm font-medium text-[var(--accent)] hover:opacity-80">
          ← Back to resorts
        </Link>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#1A1A1A]">
          Guest info — {resortName}
        </h2>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      <section className="mb-8 space-y-4 rounded-2xl border border-[#ECECEC] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-medium">Contact & notes</h3>
        <Input label="Public phone" value={publicPhone} onChange={(e) => setPublicPhone(e.target.value)} />
        <Input label="WhatsApp" value={publicWhatsapp} onChange={(e) => setPublicWhatsapp(e.target.value)} />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Arrival notes</span>
          <textarea
            rows={3}
            value={arrivalNotes}
            onChange={(e) => setArrivalNotes(e.target.value)}
            className="w-full rounded-xl border border-[#ECECEC] px-3.5 py-2.5"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Gate notes</span>
          <textarea
            rows={3}
            value={gateNotes}
            onChange={(e) => setGateNotes(e.target.value)}
            className="w-full rounded-xl border border-[#ECECEC] px-3.5 py-2.5"
          />
        </label>
        {contactSaved ? (
          <p className="text-sm text-emerald-700">Contact info saved.</p>
        ) : null}
        <Button onClick={() => void handleSaveContact()} disabled={savingContact}>
          {savingContact ? 'Saving…' : 'Save contact info'}
        </Button>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">FAQ ({faqs.length})</h3>
          <Button onClick={openFaqCreate}>Add FAQ</Button>
        </div>
        {faqs.map((faq) => (
          <div key={faq.id} className="rounded-2xl border border-[#ECECEC] bg-white p-4 shadow-sm">
            <p className="font-medium text-[#1A1A1A]">{faq.question}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{faq.answer}</p>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" onClick={() => openFaqEdit(faq)}>
                Edit
              </Button>
              <Button variant="danger" onClick={() => void handleDeleteFaq(faq)}>
                Delete
              </Button>
            </div>
          </div>
        ))}
      </section>

      {faqModalOpen ? (
        <Modal
          title={editingFaqId ? 'Edit FAQ' : 'Add FAQ'}
          onClose={() => setFaqModalOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setFaqModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleSaveFaq()} disabled={faqSaving}>
                {faqSaving ? 'Saving…' : 'Save'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input label="Question" value={faqQuestion} onChange={(e) => setFaqQuestion(e.target.value)} />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Answer</span>
              <textarea
                rows={4}
                value={faqAnswer}
                onChange={(e) => setFaqAnswer(e.target.value)}
                className="w-full rounded-xl border border-[#ECECEC] px-3.5 py-2.5"
              />
            </label>
            <Input
              label="Sort order"
              type="number"
              value={faqSortOrder}
              onChange={(e) => setFaqSortOrder(e.target.value)}
            />
            {faqError ? <p className="text-sm text-red-600">{faqError}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
