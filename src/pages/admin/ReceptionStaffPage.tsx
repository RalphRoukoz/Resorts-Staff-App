import { StaffManager } from '../../components/StaffManager'
import { useAuth } from '../../context/AuthContext'

export function ReceptionStaffPage() {
  const { resortId } = useAuth()
  return <StaffManager resortId={resortId} role="reception" />
}
