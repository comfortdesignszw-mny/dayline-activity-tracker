import { Route, Switch } from "wouter";
import Protected from "./_core/Protected";
import Dashboard from "./pages/Dashboard";
import LogActivity from "./pages/LogActivity";
import History from "./pages/History";
import Login from "./pages/Login";
import Register from "./pages/Register";

export default function App() {
  return (
    <Switch>
      <Route path="/">
        <Protected>
          <Dashboard />
        </Protected>
      </Route>
      <Route path="/log">
        <Protected>
          <LogActivity />
        </Protected>
      </Route>
      <Route path="/history">
        <Protected>
          <History />
        </Protected>
      </Route>
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route>{() => <div className="p-8">Not found</div>}</Route>
    </Switch>
  );
}
