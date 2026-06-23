import { Router, Route, Navigate, useParams } from '@solidjs/router';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import AccountList from './pages/AccountList';
import AccountDetail from './pages/AccountDetail';
import MeetingsList from './pages/MeetingsList';
import MeetingView from './pages/MeetingView';
import ContactList from './pages/ContactList';
import ContactDetail from './pages/ContactDetail';
import EventsList from './pages/EventsList';
import EventDetail from './pages/EventDetail';
import OpportunitiesList from './pages/OpportunitiesList';
import OpportunityDetail from './pages/OpportunityDetail';
import Products from './pages/Products';
import Agent from './pages/Agent';
import ImportExport from './pages/ImportExport';
import Settings from './pages/Settings';
import HomelabList from './pages/HomelabList';
import HomelabDetail from './pages/HomelabDetail';
import BrokerSecrets from './pages/BrokerSecrets';
import BrokerProxmox from './pages/BrokerProxmox';

function LegacyHomelabDetailRedirect() {
  const params = useParams<{ id: string }>();
  return <Navigate href={`/broker/${params.id}`} />;
}

export default function App() {
  return (
    <Router root={Layout}>
      <Route path="/" component={Dashboard} />
      <Route path="/accounts" component={() => <AccountList type="account" />} />
      <Route path="/partners" component={() => <AccountList type="partner" />} />
      <Route path="/accounts/:slug" component={AccountDetail} />
      <Route path="/meetings" component={() => <MeetingsList />} />
      <Route path="/meetings/:id" component={MeetingView} />
      <Route path="/contacts" component={() => <ContactList />} />
      <Route path="/contacts/:id" component={ContactDetail} />
      <Route path="/events" component={EventsList} />
      <Route path="/events/:id" component={EventDetail} />
      <Route path="/opportunities" component={() => <OpportunitiesList />} />
      <Route path="/opportunities/:id" component={OpportunityDetail} />
      <Route path="/products" component={Products} />
      <Route path="/broker" component={HomelabList} />
      <Route path="/broker/secrets" component={BrokerSecrets} />
      <Route path="/broker/proxmox" component={BrokerProxmox} />
      <Route path="/broker/:id" component={HomelabDetail} />
      <Route path="/homelab" component={() => <Navigate href="/broker" />} />
      <Route path="/homelab/:id" component={LegacyHomelabDetailRedirect} />
      <Route path="/agent" component={Agent} />
      <Route path="/import-export" component={ImportExport} />
      <Route path="/import-notes" component={() => <Navigate href="/import-export" />} />
      <Route path="/settings" component={Settings} />
    </Router>
  );
}
