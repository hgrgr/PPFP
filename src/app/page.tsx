import { redirect } from 'next/navigation';
import { currentUser } from '@/server/auth';

export default async function Home() {
  redirect((await currentUser()) ? '/dashboard' : '/login');
}
