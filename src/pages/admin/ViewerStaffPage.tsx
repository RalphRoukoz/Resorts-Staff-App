import { StaffManager } from '../../components/StaffManager'
import { useAuth } from '../../context/AuthContext'

export function ViewerStaffPage() {
  const { resortId } = useAuth()
  return <StaffManager resortId={resortId} role="viewer" />
}
