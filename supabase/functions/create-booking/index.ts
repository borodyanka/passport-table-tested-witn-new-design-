import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey);

    // Визначаємо, чи користувач авторизований
    let userId: string | null = null;
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (jwt && jwt !== Deno.env.get('SUPABASE_ANON_KEY')) {
      const { data: userData } = await admin.auth.getUser(jwt);
      if (userData?.user) {
        userId = userData.user.id;
      }
    }

    const body = await req.json();
    const fullName = String(body.full_name || '').trim();
    const phone = String(body.phone || '').trim();
    const service = String(body.service || '').trim();
    const visitDate = String(body.visit_date || '').trim();
    const bookingType = String(body.booking_type || 'scheduled').trim();
    const appointmentTime = body.appointment_time ? String(body.appointment_time).trim() : null;
    const notes = String(body.notes || '').trim().slice(0, 300);

    if (fullName.length < 3 || phone.length < 7) {
      return json({ error: 'Вкажіть коректне ПІБ та номер телефону.' }, 400);
    }
    if (!visitDate) {
      return json({ error: 'Вкажіть дату прийому.' }, 400);
    }
    if (bookingType === 'scheduled' && !appointmentTime) {
      return json({ error: 'Оберіть час прийому.' }, 400);
    }

    // Перевірка статусу прийому
    const { data: sysStatus } = await admin
      .from('system_status')
      .select('is_working, reason')
      .eq('date', visitDate)
      .maybeSingle();

    if (sysStatus && !sysStatus.is_working) {
      return json({ error: `Прийом призупинено: ${sysStatus.reason || 'технічна перерва'}` }, 409);
    }

    // Перевірка зайнятості часу
    if (bookingType === 'scheduled' && appointmentTime) {
      const { data: existing } = await admin
        .from('appointments')
        .select('id')
        .eq('visit_date', visitDate)
        .eq('appointment_time', appointmentTime)
        .in('status', ['waiting', 'serving'])
        .maybeSingle();

      if (existing) {
        return json({ error: 'Цей час уже зайнято. Будь ласка, оберіть інший слот.' }, 409);
      }
    }

    // Отримання чергового номера талона
    const { data: maxRecord } = await admin
      .from('appointments')
      .select('queue_number')
      .eq('visit_date', visitDate)
      .order('queue_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextQueueNumber = (maxRecord?.queue_number || 0) + 1;

    // Створення запису
    const { data: newAppointment, error: insertError } = await admin
      .from('appointments')
      .insert({
        user_id: userId,
        queue_number: nextQueueNumber,
        full_name: fullName,
        phone: phone,
        service: service,
        visit_date: visitDate,
        booking_type: bookingType,
        appointment_time: bookingType === 'scheduled' ? appointmentTime : null,
        notes: notes || null,
        status: 'waiting'
      })
      .select('id, queue_number, visit_date, booking_type, appointment_time, service')
      .single();

    if (insertError) throw insertError;

  return json({
      ok: true,
      id: newAppointment.id,
      queue_number: newAppointment.queue_number,
      visit_date: newAppointment.visit_date,
      booking_type: newAppointment.booking_type,
      appointment_time: newAppointment.appointment_time,
      service: newAppointment.service
    });
  } catch (e: any) {
    console.error('create-booking error:', e);
    return json({ error: e.message || 'Не вдалося створити запис.' }, 500);
  }
});
  } catch (e: any) {
    console.error('create-booking error:', e);
    return json({ error: e.message || 'Не вдалося створити запис.' }, 500);
  }
});
